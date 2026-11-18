// Web Push for the installed PWA and desktop browsers. The backend holds the VAPID keys and sends to
// the push service the browser picked; this side only asks for permission (always from a click, which
// iOS requires), subscribes and reports whether the app is visible (no push while you look at it).
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { getConnection } from './backend'
import type { PushSettings } from './types'

export const DEFAULT_PUSH: PushSettings = {
  approval: true, done: true, error: true, paseo: true, skipWhenVisible: true,
  quiet: { enabled: false, from: '22:00', to: '07:00' }, tz: null,
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

type PushState = {
  status: 'unknown' | 'unsupported' | 'needs-install' | 'off' | 'on' | 'denied' | 'disabled'
  endpoint: string | null
  settings: PushSettings
  publicKey: string | null
}
let ps: PushState = { status: 'unknown', endpoint: null, settings: DEFAULT_PUSH, publicKey: null }
const subs = new Set<() => void>()
const setPs = (p: Partial<PushState>) => { ps = { ...ps, ...p }; subs.forEach((l) => l()) }
export const usePush = () => useSyncExternalStore((l) => { subs.add(l); return () => subs.delete(l) }, () => ps)

const swUrl = () => new URL('sw.js', location.href.replace(/[^/]*$/, '')).pathname

/**
 * One service worker per scope: sw.js = iroh-fetch's bridge (imported) + push handling. Over iroh,
 * backend.ts registers it through iroh-fetch (with its hosts); locally it is registered here.
 */
export async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    if (getConnection().mode === 'local') {
      const existing = await navigator.serviceWorker.getRegistration()
      if (!existing?.active?.scriptURL.includes('/sw.js')) await navigator.serviceWorker.register(swUrl())
    }
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 6000))])
  } catch { return null }
}

const keyBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return null } }

export async function refreshPush() {
  if (!pushSupported()) { setPs({ status: isIOS && !isStandalone() ? 'needs-install' : 'unsupported' }); return }
  try {
    const r = await api<{ publicKey: string; subscriptions: { endpoint: string; settings: PushSettings }[] }>('/api/push')
    const reg = await registration()
    const sub = await reg?.pushManager.getSubscription()
    const mine = sub && r.subscriptions.find((x) => x.endpoint === sub.endpoint)
    const status = Notification.permission === 'denied' ? 'denied' : mine ? 'on' : 'off'
    setPs({ status, publicKey: r.publicKey, endpoint: mine ? sub!.endpoint : null, settings: mine?.settings || ps.settings })
  } catch (err) {
    setPs({ status: err instanceof Error && /disabled/.test(err.message) ? 'disabled' : 'unsupported' })
  }
}

/** Must run inside a click handler (iOS only shows the permission prompt for a user gesture). */
export async function enablePush(settings: PushSettings = ps.settings) {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') { setPs({ status: perm === 'denied' ? 'denied' : 'off' }); throw new Error(perm === 'denied' ? 'denied' : 'dismissed') }
  const reg = await registration()
  if (!reg) throw new Error('no service worker')
  if (!ps.publicKey) await refreshPush()
  let sub = await reg.pushManager.getSubscription()
  // A subscription made for another backend key cannot be used: replace it.
  const key = sub?.options.applicationServerKey
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== ps.publicKey) {
    await sub.unsubscribe(); sub = null
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(ps.publicKey!) })
  const r = await api<{ endpoint: string; settings: PushSettings }>('/api/push/subscribe', { method: 'POST', json: { subscription: sub.toJSON(), settings: { ...settings, tz: tz() } } })
  setPs({ status: 'on', endpoint: r.endpoint, settings: r.settings })
  reportPresence()
}

export async function disablePush() {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
  setPs({ status: 'off', endpoint: null })
}

export async function savePushSettings(patch: Partial<PushSettings>) {
  const settings = { ...ps.settings, ...patch, tz: tz() }
  setPs({ settings })
  if (!ps.endpoint) return
  const r = await api<{ settings: PushSettings }>('/api/push/settings', { method: 'POST', json: { endpoint: ps.endpoint, settings } })
  setPs({ settings: r.settings })
}

export async function testPush() {
  if (!ps.endpoint) throw new Error('not subscribed')
  await api('/api/push/test', { method: 'POST', json: { endpoint: ps.endpoint } })
}

// "Don't push while the app is open and visible": the backend needs to know. Heartbeat while visible.
let presenceTimer: ReturnType<typeof setInterval> | undefined
export function reportPresence() {
  const visible = document.visibilityState === 'visible'
  api('/api/push/presence', { method: 'POST', json: { visible } }).catch(() => {})
}
export function startPresence() {
  const tick = () => {
    clearInterval(presenceTimer)
    reportPresence()
    if (document.visibilityState === 'visible') presenceTimer = setInterval(reportPresence, 30000)
  }
  document.addEventListener('visibilitychange', tick)
  window.addEventListener('pagehide', () => api('/api/push/presence', { method: 'POST', json: { visible: false }, keepalive: true }).catch(() => {}))
  tick()
}
