import { t } from './i18n'
// Board state: one small external store fed by REST + the /api/events SSE stream.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { api, Unauthorized } from './api'
import { apiUrl, getConnection, connectIroh, consumePairCode, sameOriginBackend, savedRemote, takePairingFragment } from './backend'
import type { Column, Device, OutgoingMessage, RemoteState, Session, ThreadMessage } from './types'

type State = {
  auth: 'unknown' | 'ok' | 'required' | 'no-backend'
  sessions: Record<string, Session>
  gateway: boolean
  live: boolean
  remote: RemoteState | null
  devices: Device[]
  isLocal: boolean
  days: number
  system: boolean
  search: string
  source: string
  openId: string | null
  messages: ThreadMessage[]
  loadingThread: boolean
  streaming: { id: string; text: string } | null
  pendingFirst: { id: string; text: string; ts: number } | null
  flash: string | null
  highlight: number | null // message id to scroll to and mark (search hit)
  highlightQuery: string
}

let state: State = {
  auth: 'unknown',
  sessions: {},
  gateway: false,
  live: false,
  remote: null,
  devices: [],
  isLocal: true,
  days: Number(localStorage.getItem('hk_days') || 3),
  system: localStorage.getItem('hk_system') === '1',
  search: '',
  source: '',
  openId: null,
  messages: [],
  loadingThread: false,
  streaming: null,
  pendingFirst: null,
  flash: null,
  highlight: null,
  highlightQuery: '',
}
const listeners = new Set<() => void>()
const set = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((l) => l())
}
export const getState = () => state
export function useBoard<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => select(state))
}

function upsert(s: Session, flash = false) {
  set((st) => {
    const prev = st.sessions[s.id]
    return { sessions: { ...st.sessions, [s.id]: s }, flash: flash || (prev && prev.column !== s.column) ? s.id : st.flash }
  })
}
function remove(id: string) {
  set((st) => {
    const sessions = { ...st.sessions }
    delete sessions[id]
    return { sessions, openId: st.openId === id ? null : st.openId }
  })
}

const handle = (err: unknown) => {
  if (err instanceof Unauthorized) { set({ auth: 'required' }); return }
  // Over iroh a refused connection (device not paired / revoked, gateway down) surfaces as a network error.
  if (getConnection().mode === 'iroh' && err instanceof TypeError && state.auth !== 'ok') { set({ auth: 'required' }); return }
  toast.error(err instanceof Error ? err.message : String(err))
}

// ---------- loading ----------
export async function loadSessions() {
  try {
    const { sessions, gateway } = await api<{ sessions: Session[]; gateway: boolean }>(`/api/sessions?days=${state.days}&system=${state.system ? 1 : 0}`)
    set({ auth: 'ok', gateway, sessions: Object.fromEntries(sessions.map((s) => [s.id, s])) })
    return true
  } catch (err) { handle(err); return false }
}

export async function loadRemote() {
  try {
    const r = await api<{ remote: RemoteState; devices: Device[]; local: boolean }>('/api/remote')
    set({ remote: r.remote, devices: r.devices, isLocal: r.local })
  } catch (err) { handle(err) }
}

export function setFilter(patch: Partial<Pick<State, 'days' | 'system' | 'search' | 'source'>>) {
  set(patch)
  if ('days' in patch) localStorage.setItem('hk_days', String(patch.days))
  if ('system' in patch) localStorage.setItem('hk_system', patch.system ? '1' : '0')
  if ('days' in patch || 'system' in patch) loadSessions()
}

// ---------- thread ----------
function withPending(id: string, messages: ThreadMessage[]) {
  const p = state.pendingFirst
  if (!p || p.id !== id) return messages
  if (messages.some((m) => m.role === 'user')) { set({ pendingFirst: null }); return messages }
  return [{ role: 'user' as const, text: p.text, ts: p.ts }, ...messages]
}

export async function openThread(id: string | null, opts: { highlight?: number; query?: string; session?: Session } = {}) {
  // A search hit can be older than the board's window: show its card until the next reload.
  if (id && opts.session && !state.sessions[id]) upsert(opts.session)
  set({ openId: id, messages: [], loadingThread: !!id, highlight: opts.highlight ?? null, highlightQuery: opts.query || '', streaming: state.streaming?.id === id ? state.streaming : null })
  if (id) history.replaceState(null, '', `#${encodeURIComponent(id)}`)
  else history.replaceState(null, '', location.pathname)
  if (id) await refreshThread(id)
}

export const clearHighlight = () => set({ highlight: null })

export type SearchHit = { session: Session & { archived?: boolean }; hit?: { msgId: number; role: string; ts: number; snippet: string; hits: number }; alsoTitle?: boolean }
export async function searchChats(q: string, archived: boolean, signal?: AbortSignal) {
  return api<{ q: string; title: SearchHit[]; content: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}${archived ? '&archived=1' : ''}`, { signal })
}

export async function refreshThread(id: string) {
  try {
    const { session, messages } = await api<{ session: Session; messages: ThreadMessage[] }>(`/api/sessions/${encodeURIComponent(id)}`)
    if (state.openId !== id) return
    upsert(session)
    set({ messages: withPending(id, messages), loadingThread: false })
  } catch (err) { set({ loadingThread: false }); handle(err) }
}

// ---------- actions ----------
export async function setColumn(id: string, column: Column | 'auto') {
  try {
    const res = await api<{ session: Session | null; removed?: string; replaced?: string }>(`/api/sessions/${encodeURIComponent(id)}/column`, { method: 'POST', json: { column } })
    if (res.removed || res.replaced) remove((res.removed || res.replaced)!)
    if (res.session) upsert(res.session, true)
    if (res.replaced && res.session && state.openId === null) return
    if (res.replaced && res.session) openThread(res.session.id)
  } catch (err) { handle(err); loadSessions() }
}

// Automated E2E runs mark their chats as "TEST · …" without any visible switch: they set
// localStorage hk_e2e_test=1 in their own browser profile (or POST test: true to the API directly).
const e2eTest = () => { try { return localStorage.getItem('hk_e2e_test') === '1' } catch { return false } }

export async function createChat(msg: OutgoingMessage) {
  const { session } = await api<{ session: Session }>('/api/sessions', { method: 'POST', json: e2eTest() ? { ...msg, test: true } : msg })
  upsert(session, true)
  if (!msg.draft) {
    set({ pendingFirst: { id: session.id, text: msg.text || (msg.audio ? '🎙 Sprachnachricht …' : ''), ts: Date.now() / 1000 } })
    openThread(session.id)
  }
  return session
}

export async function sendMessage(id: string, msg: OutgoingMessage) {
  const res = await api<{ session: Session; message?: ThreadMessage }>(`/api/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', json: msg })
  if (res.session && res.session.id !== id) { remove(id); upsert(res.session, true); openThread(res.session.id); return }
  if (res.session) upsert(res.session)
  const message = res.message
  if (message && state.openId === id) set((st) => ({ messages: [...st.messages, message] }))
}

export async function respond(id: string, body: { promptId: string; choice?: string; answer?: string; answers?: string[] }) {
  try {
    const res = await api<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}/respond`, { method: 'POST', json: body })
    if (res.session) upsert(res.session)
    return true
  } catch (err) { handle(err); refreshThread(id); return false }
}

export async function interrupt(id: string) {
  try { await api(`/api/sessions/${encodeURIComponent(id)}/interrupt`, { method: 'POST' }); toast('Stopp gesendet') } catch (err) { handle(err) }
}

export async function login(token: string) {
  await api('/api/login', { method: 'POST', json: { token, name: deviceName() } })
  set({ auth: 'ok' })
}
export async function redeemPairing(code: string) {
  await api('/api/pair/redeem', { method: 'POST', json: { code, name: deviceName() } })
  set({ auth: 'ok' })
}
export async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {})
  set({ auth: 'required' })
}
export async function revokeDevice(id: string) {
  try {
    const r = await api<{ devices: Device[] }>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
    set({ devices: r.devices })
  } catch (err) { handle(err) }
}
function deviceName() {
  const ua = navigator.userAgent
  const dev = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Browser'
  const br = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  return `${dev}${br ? ` · ${br}` : ''}`
}

// ---------- live events ----------
let es: EventSource | null = null
let reloadTimer: ReturnType<typeof setTimeout> | undefined
export function connectEvents() {
  es?.close()
  es = new EventSource(apiUrl('/api/events'), { withCredentials: true })
  es.onopen = () => set({ live: true })
  es.onerror = () => set({ live: false })
  const on = <T,>(name: string, fn: (d: T) => void) => es!.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)))
  on<Session>('session', (s) => {
    if (s.system && !state.system && !state.sessions[s.id]) return
    upsert(s)
  })
  on<{ id: string }>('removed', ({ id }) => remove(id))
  on<{ connected: boolean }>('gateway', ({ connected }) => set({ gateway: connected }))
  on<RemoteState>('remote', (remote) => set({ remote }))
  on<Device[]>('devices', (devices) => set({ devices }))
  on<{ id: string; text: string }>('delta', ({ id, text }) => {
    set((st) => ({ streaming: { id, text: (st.streaming?.id === id ? st.streaming.text : '') + text } }))
  })
  on<{ id: string; message: ThreadMessage }>('message', ({ id, message }) => {
    if (id !== state.openId) return
    set((st) => ({ messages: [...st.messages, message] }))
  })
  on<{ id: string; final: boolean }>('reload', ({ id, final }) => {
    if (final && state.streaming?.id === id) set({ streaming: null })
    if (id !== state.openId) return
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => refreshThread(id), 250)
  })
}

// ---------- startup ----------
// 1. a pairing link (#iroh=…&pair=…) → connect over iroh and redeem the code
// 2. a backend on our own origin → local mode (token / device cookie)
// 3. a remembered iroh endpoint → connect over iroh
// 4. nothing → ask for a pairing link
export async function bootstrap() {
  const fromLink = takePairingFragment()
  const remote = fromLink || ((await sameOriginBackend()) ? null : savedRemote())
  if (!remote) {
    if (location.pathname.endsWith('/pair')) return // legacy tunnel pairing, handled by <Login>
    if (await sameOriginBackend()) { await loadSessions(); return }
    set({ auth: 'no-backend' })
    return
  }
  await connectIroh(remote)
  const code = consumePairCode()
  if (code) {
    try { await api('/api/pair/redeem', { method: 'POST', json: { code, name: deviceName() } }); toast.success(t('Gerät gekoppelt')) } catch (err) { handle(err) }
  }
  await loadSessions()
}
