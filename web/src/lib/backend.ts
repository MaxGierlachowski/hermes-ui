// Where the UI's backend lives. The UI is a static bundle without data or secrets, so it can be
// served by the backend itself (same origin, "local") or from any static host such as GitHub Pages,
// in which case it reaches the backend over iroh (WASM, end-to-end encrypted, via an iroh relay).
//
// A pairing link looks like  <ui-url>/#iroh=<gateway endpoint id>&relay=<relay url>&pair=<one-time code>[&base=<path>]
// The fragment never reaches any web server; the endpoint is remembered in localStorage. `base` is the
// path prefix the backend lives under behind a reverse proxy (e.g. /hermes on an agentbox): every API
// call, the event stream and the pairing call are then sent to {base}/api/….

import { swUrl } from './sw-url'

export type RemoteConfig = { endpointId: string; relayUrl?: string; name?: string; base?: string }
export type Connection =
  | { mode: 'local'; base: string; status: 'ready' }
  | { mode: 'iroh'; base: string; status: 'connecting' | 'ready' | 'error'; endpointId: string; error?: string; serviceWorker: boolean }

/** '/hermes/' → '/hermes'; anything that is not a plain absolute path → ''. */
export function cleanBase(raw: unknown): string {
  const p = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : ''
  if (!p || !/^(\/[A-Za-z0-9._~-]+)+$/.test(p) || p.split('/').some((s) => s === '.' || s === '..')) return ''
  return p
}

/**
 * Settings the backend injects into index.html when it serves the UI (see server.mjs): the URL prefix
 * the browser sees (HERMES_UI_BASE_PATH), the auth mode and, behind a proxy, where devices get paired.
 * A static copy of the UI (GitHub Pages, `vite preview`) has none of this and uses the defaults.
 */
export type PageConfig = { base: string; auth: 'token' | 'proxy'; pairingUrl: string | null }
export const pageConfig: PageConfig = (() => {
  const fallback: PageConfig = { base: '', auth: 'token', pairingUrl: null }
  if (typeof document === 'undefined') return fallback
  try {
    const c = JSON.parse(document.querySelector('meta[name="hermes-ui-config"]')?.getAttribute('content') || '{}')
    return { base: cleanBase(c.base), auth: c.auth === 'proxy' ? 'proxy' : 'token', pairingUrl: typeof c.pairingUrl === 'string' && c.pairingUrl ? c.pairingUrl : null }
  } catch { return fallback }
})()

const STORE_KEY = 'hk_remote'
export const IROH_ORIGIN = 'https://hermes-ui.iroh' // virtual origin; only the path reaches the backend

let conn: Connection = { mode: 'local', base: pageConfig.base, status: 'ready' }
let pendingPairCode: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const onConnectionChange = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export const getConnection = () => conn

/** URL for an API path: same origin (+ base path) locally, the virtual iroh origin (+ base path) remotely. */
export const apiUrl = (path: string) => (path.startsWith('/api/') ? `${conn.base}${path}` : path)

export function savedRemote(): RemoteConfig | null {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { return null }
}

export function forgetRemote() {
  localStorage.removeItem(STORE_KEY)
  location.replace(location.pathname)
}

/** Reads `#iroh=…&relay=…&pair=…&base=…`, stores the endpoint and keeps the pairing code for one redeem. */
export function takePairingFragment(): RemoteConfig | null {
  const h = new URLSearchParams(location.hash.slice(1))
  const endpointId = h.get('iroh')
  if (!endpointId || !/^[0-9a-f]{64}$/.test(endpointId)) return null
  const cfg: RemoteConfig = { endpointId, relayUrl: h.get('relay') || undefined, base: cleanBase(h.get('base')) || undefined }
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
  pendingPairCode = h.get('pair')
  history.replaceState(null, '', location.pathname + location.search)
  return cfg
}
export const consumePairCode = () => { const c = pendingPairCode; pendingPairCode = null; return c }

/** Is a backend answering on our own origin? (true when the backend serves this UI) */
export async function sameOriginBackend(): Promise<boolean> {
  try {
    // Relative to the document base: the backend injects <base href="{base}/"> when it serves the UI.
    const res = await fetch(new URL('api/health', document.baseURI), { credentials: 'same-origin' })
    return res.headers.get('content-type')?.includes('application/json') ?? false
  } catch { return false }
}

export async function connectIroh(cfg: RemoteConfig) {
  conn = { mode: 'iroh', base: IROH_ORIGIN + cleanBase(cfg.base), status: 'connecting', endpointId: cfg.endpointId, serviceWorker: false }
  emit()
  try {
    const { createIrohFetch } = await import('iroh-fetch')
    const iroh = await createIrohFetch({
      backends: { [IROH_ORIGIN]: cfg.relayUrl ? { endpointId: cfg.endpointId, relayUrl: cfg.relayUrl } : cfg.endpointId },
      persistIdentity: true, // stable device id: the gateway's allow-list and the server know this device
    })
    // Global fetch / EventSource / XHR / WebSocket for IROH_ORIGIN now go over iroh.
    iroh.install({ origins: [IROH_ORIGIN] })
    let sw = false
    try {
      // sw.js imports iroh-fetch's worker (iroh-sw.js) and adds push notifications: one worker per scope.
      const r = await iroh.serviceWorker({ url: swUrl(), hosts: [new URL(IROH_ORIGIN).host] })
      sw = r.controlled
    } catch { /* no service worker (private mode, in-app browsers): images fall back to blob URLs */ }
    objectUrl = (u: string) => iroh.objectUrl(u)
    conn = { ...conn, status: 'ready', serviceWorker: sw } as Connection
  } catch (err) {
    conn = { ...conn, status: 'error', error: err instanceof Error ? err.message : String(err) } as Connection
  }
  emit()
}

// Media (<img>/<audio>) of backend URLs: the service worker routes them; without it, load as blob.
let objectUrl: ((u: string) => Promise<string>) | null = null
export const mediaNeedsBlob = () => conn.mode === 'iroh' && !conn.serviceWorker
export const loadObjectUrl = (u: string) => (objectUrl ? objectUrl(u) : Promise.resolve(u))
