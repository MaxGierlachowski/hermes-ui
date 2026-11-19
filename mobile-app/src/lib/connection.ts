// The app's one backend connection: iroh to the paired hermes-ui backend through the native
// expo-iroh module (Rust, direct UDP paths with the relay as fallback).
//
// Stored in the platform keystore (expo-secure-store → Android Keystore / iOS Keychain):
//   - the gateway (endpoint id + relay hint) this app is paired with,
//   - this device's iroh secret key, so its endpoint id (what the gateway allow-lists) never changes.
import * as SecureStore from 'expo-secure-store'
import { Directory, File, Paths } from 'expo-file-system'
import { IrohBackend, IrohError, type ConnectionPath, type Gateway } from 'expo-iroh'
import { Platform } from 'react-native'

const GATEWAY_KEY = 'hermes-ui.gateway'
const SECRET_KEY = 'hermes-ui.iroh-secret-key'

export class Unauthorized extends Error {}
/** No backend connection yet (still connecting, or offline with cached content on screen). */
export class NotConnected extends Error {}
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** What the app needs from a connection: the iroh backend, or the demo mode's stand-in (demo.ts). */
export type Backend = {
  readonly gateway: Gateway
  /** This device's endpoint id. */
  readonly endpointId: string
  fetch(path: string, init?: { method?: string; json?: unknown; timeoutMs?: number; signal?: AbortSignal }): Promise<{ status: number; ok: boolean; text(): Promise<string>; cancel(): void }>
  events(path: string, onEvent: (event: string, data: string) => void, onState?: (open: boolean) => void): () => void
  download(path: string, fileUri: string): Promise<{ status: number }>
  connectionInfo(): ConnectionPath | null
  relayProblem(): string | null | undefined
}

let backend: Backend | null = null
export const getBackend = () => backend
/** Demo mode: a stand-in answers instead of a backend (nothing is stored in the keystore). */
export function setDemoBackend(b: (Backend & { close(): void }) | null) {
  if (backend && 'close' in backend && backend !== b) (backend as { close(): void }).close()
  backend = b
}

export async function savedGateway(): Promise<Gateway | null> {
  try { return JSON.parse((await SecureStore.getItemAsync(GATEWAY_KEY)) || 'null') } catch { return null }
}

/** Creates the endpoint (with the stored identity) and dials the gateway. */
export async function connect(gateway: Gateway, timeoutMs = 20_000) {
  const t0 = Date.now()
  const secretKey = await SecureStore.getItemAsync(SECRET_KEY)
  const b = await IrohBackend.connect(gateway, { secretKey, timeoutMs, lazy: true })
  const t1 = Date.now()
  if (b.secretKey !== secretKey) await SecureStore.setItemAsync(SECRET_KEY, b.secretKey)
  backend = b
  // Dial now, but don't fail here: requests redial, and the board shows "offline" meanwhile.
  try { await b.dial(timeoutMs) } catch { /* reported by the first request */ }
  // One log line per connect (logcat tag ReactNativeJS): endpoint setup, dial, and the path it took.
  const path = b.connectionInfo()
  console.log(`[hermes-ui] iroh endpoint ${t1 - t0} ms, dial ${Date.now() - t1} ms, path ${path?.kind ?? 'none'}${path?.paths.find((p) => p.selected) ? ` ${path.paths.find((p) => p.selected)!.rttMs.toFixed(1)} ms rtt` : ''}`)
  return b
}

export async function rememberGateway(gateway: Gateway) {
  await SecureStore.setItemAsync(GATEWAY_KEY, JSON.stringify(gateway))
}

/** Forgets the paired backend. The device identity stays (pairing again keeps the same device id). */
export async function forgetGateway() {
  await SecureStore.deleteItemAsync(GATEWAY_KEY)
  backend = null
  await IrohBackend.close().catch(() => {})
}

export const deviceName = () => `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} · Hermes UI app`

/** JSON API call over iroh. 401 / 403 (gateway refuses this device) → Unauthorized. */
export async function api<T = unknown>(path: string, init: { method?: string; json?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  if (!backend) throw new NotConnected('not connected')
  const res = await backend.fetch(path, { method: init.method, json: init.json, timeoutMs: init.timeoutMs, signal: init.signal })
  if (res.status === 401 || res.status === 403) { res.cancel(); throw new Unauthorized('unauthorized') }
  const text = await res.text()
  let body: unknown = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: text.slice(0, 200) } }
  if (!res.ok) throw new ApiError((body as { error?: string }).error || `HTTP ${res.status}`, res.status)
  return body as T
}

export const isNetworkError = (e: unknown) => e instanceof IrohError || e instanceof NotConnected

// ---------- media: backend URLs (/api/media/…, /api/file?…) as local files for <Image>/players ----------
const mediaDir = () => {
  const dir = new Directory(Paths.cache, 'media')
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}
const inflight = new Map<string, Promise<string>>()
const MEDIA_MAX_BYTES = 200 * 1024 * 1024

/** Keeps the media cache under MEDIA_MAX_BYTES, oldest files first (the OS may also clear it). */
export function pruneMedia() {
  try {
    const files = mediaDir().list().filter((f): f is File => f instanceof File)
      .map((f) => ({ f, size: f.size ?? 0, t: f.modificationTime ?? 0 }))
      .sort((a, b) => b.t - a.t)
    let total = 0
    for (const { f, size } of files) {
      total += size
      if (total > MEDIA_MAX_BYTES) { try { f.delete() } catch { /* in use or gone */ } }
    }
  } catch { /* nothing cached yet */ }
}

export function clearMedia() {
  try { new Directory(Paths.cache, 'media').delete() } catch { /* nothing cached */ }
}

const hash = (s: string) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

const mediaPath = (url: string) => {
  const ext = (url.split('?')[0].match(/\.(\w{2,5})$/)?.[1] || decodeURIComponent(url).match(/\.(png|jpe?g|gif|webp|heic|m4a|mp3|ogg|opus|wav|webm|mp4)\b/i)?.[1] || 'bin').toLowerCase()
  return new File(mediaDir(), `${hash(url)}.${ext}`)
}

/** Already on disk? Then a screen can render the image in its first frame instead of a spinner. */
export function cachedMediaFile(url: string): string | null {
  if (!url.startsWith('/api/')) return url
  try { const file = mediaPath(url); return file.exists ? file.uri : null } catch { return null }
}

/** file:// URI of a backend media URL, downloaded over iroh once and cached. */
export function mediaFile(url: string): Promise<string> {
  if (!url.startsWith('/api/')) return Promise.resolve(url)
  const file = mediaPath(url)
  if (file.exists) return Promise.resolve(file.uri)
  let p = inflight.get(url)
  if (!p) {
    p = (async () => {
      if (!backend) throw new NotConnected('not connected')
      const r = await backend.download(url, file.uri)
      if (r.status < 200 || r.status >= 300) throw new ApiError(`HTTP ${r.status}`, r.status)
      return file.uri
    })().finally(() => inflight.delete(url))
    inflight.set(url, p)
  }
  return p
}
