// The app's one backend connection: iroh to the paired hermes-ui backend through the native
// expo-iroh module (Rust, direct UDP paths with the relay as fallback).
//
// Stored in the platform keystore (expo-secure-store → Android Keystore / iOS Keychain):
//   - the gateway (endpoint id + relay hint) this app is paired with,
//   - this device's iroh secret key, so its endpoint id (what the gateway allow-lists) never changes.
import * as SecureStore from 'expo-secure-store'
import { Directory, File, Paths } from 'expo-file-system'
import { IrohBackend, IrohError, type Gateway } from 'expo-iroh'
import { Platform } from 'react-native'

const GATEWAY_KEY = 'hermes-ui.gateway'
const SECRET_KEY = 'hermes-ui.iroh-secret-key'

export class Unauthorized extends Error {}
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

let backend: IrohBackend | null = null
export const getBackend = () => backend

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
  if (!backend) throw new Unauthorized('not connected')
  const res = await backend.fetch(path, { method: init.method, json: init.json, timeoutMs: init.timeoutMs, signal: init.signal })
  if (res.status === 401 || res.status === 403) { res.cancel(); throw new Unauthorized('unauthorized') }
  const text = await res.text()
  let body: unknown = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: text.slice(0, 200) } }
  if (!res.ok) throw new ApiError((body as { error?: string }).error || `HTTP ${res.status}`, res.status)
  return body as T
}

export const isNetworkError = (e: unknown) => e instanceof IrohError

// ---------- media: backend URLs (/api/media/…, /api/file?…) as local files for <Image>/players ----------
const mediaDir = () => {
  const dir = new Directory(Paths.cache, 'media')
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}
const inflight = new Map<string, Promise<string>>()

const hash = (s: string) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

/** file:// URI of a backend media URL, downloaded over iroh once and cached. */
export function mediaFile(url: string): Promise<string> {
  if (!url.startsWith('/api/')) return Promise.resolve(url)
  const ext = (url.split('?')[0].match(/\.(\w{2,5})$/)?.[1] || decodeURIComponent(url).match(/\.(png|jpe?g|gif|webp|heic|m4a|mp3|ogg|opus|wav|webm|mp4)\b/i)?.[1] || 'bin').toLowerCase()
  const file = new File(mediaDir(), `${hash(url)}.${ext}`)
  if (file.exists) return Promise.resolve(file.uri)
  let p = inflight.get(url)
  if (!p) {
    p = (async () => {
      if (!backend) throw new Unauthorized('not connected')
      const r = await backend.download(url, file.uri)
      if (r.status < 200 || r.status >= 300) throw new ApiError(`HTTP ${r.status}`, r.status)
      return file.uri
    })().finally(() => inflight.delete(url))
    inflight.set(url, p)
  }
  return p
}
