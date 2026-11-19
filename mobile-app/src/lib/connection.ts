// The app's one backend connection, the same on every platform. What carries the requests is a
// platform layer (transport.ts / transport.web.ts):
//
//   - iOS / Android: iroh through the native expo-iroh module (Rust, direct UDP paths, relay fallback),
//   - web remote:   iroh through iroh-fetch (WASM in the browser, same pairing links as the web UI),
//   - desktop/local: plain HTTP to a backend on 127.0.0.1 (the Tauri app's sidecar or a running one),
//   - demo mode:     a stand-in that answers from sample data (demo.ts).
//
// Everything above this file (store, screens) only sees paths like /api/sessions.
import {
  activeTarget, closeTransport, deviceName, forgetTarget, isTransportError, libraryInfo, openTransport,
  rememberTarget, savedTarget, type Target,
} from './transport'

export type { Target }
export { deviceName, libraryInfo }

export class Unauthorized extends Error {}
/** No backend connection yet (still connecting, or offline with cached content on screen). */
export class NotConnected extends Error {}
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export type ConnectionPath = { kind: 'direct' | 'relay' | 'none'; paths: { kind: string; addr: string; selected: boolean; rttMs: number }[] }
export type Gateway = { endpointId: string; relayUrl?: string }

/** What the app needs from a connection: a transport, or the demo mode's stand-in (demo.ts). */
export type Backend = {
  /** How it is reached: iroh endpoint (endpointId) or HTTP base URL (endpointId = the URL). */
  readonly gateway: Gateway
  /** This device's endpoint id (iroh) or a label (HTTP). */
  readonly endpointId: string
  fetch(path: string, init?: { method?: string; json?: unknown; timeoutMs?: number; signal?: AbortSignal }): Promise<{ status: number; ok: boolean; text(): Promise<string>; cancel(): void }>
  events(path: string, onEvent: (event: string, data: string) => void, onState?: (open: boolean) => void): () => void
  /** Native: writes the body of GET `path` to a file (media cache). */
  download?(path: string, fileUri: string): Promise<{ status: number }>
  /** Web: a URL an <img>/<audio> can load directly (object URL, data URL or tokenised HTTP URL). */
  mediaUrl?(path: string): Promise<string> | string
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

export { savedTarget, activeTarget }

/** Opens the transport for a target (iroh endpoint or local HTTP backend) and makes it the backend. */
export async function connect(target: Target, timeoutMs = 20_000) {
  backend = await openTransport(target, timeoutMs)
  return backend
}

export const rememberGateway = rememberTarget

/** Forgets the paired backend. The device identity stays (pairing again keeps the same device id). */
export async function forgetGateway() {
  await forgetTarget()
  backend = null
  await closeTransport().catch(() => {})
}

/** JSON API call. 401 / 403 (the backend refuses this device) → Unauthorized. */
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

export const isNetworkError = (e: unknown) => e instanceof NotConnected || isTransportError(e)

export { cachedMediaFile, clearMedia, mediaFile, pruneMedia } from './media'
