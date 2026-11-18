// Where the UI's backend lives. The UI is a static bundle without data or secrets, so it can be
// served by the backend itself (same origin, "local") or from any static host such as GitHub Pages,
// in which case it reaches the backend over iroh (WASM, end-to-end encrypted, via an iroh relay).
//
// A pairing link looks like  <ui-url>/#iroh=<gateway endpoint id>&relay=<relay url>&pair=<one-time code>
// The fragment never reaches any web server; the endpoint is remembered in localStorage.

export type RemoteConfig = { endpointId: string; relayUrl?: string; name?: string }
export type Connection =
  | { mode: 'local'; base: ''; status: 'ready' }
  | { mode: 'iroh'; base: string; status: 'connecting' | 'ready' | 'error'; endpointId: string; error?: string; serviceWorker: boolean }

const STORE_KEY = 'hk_remote'
export const IROH_ORIGIN = 'https://hermes-ui.iroh' // virtual origin; only the path reaches the backend

let conn: Connection = { mode: 'local', base: '', status: 'ready' }
let pendingPairCode: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const onConnectionChange = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export const getConnection = () => conn

/** Absolute URL for an API path (same origin locally, the virtual iroh origin remotely). */
export const apiUrl = (path: string) => (path.startsWith('/api/') ? `${conn.base}${path}` : path)

export function savedRemote(): RemoteConfig | null {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { return null }
}

export function forgetRemote() {
  localStorage.removeItem(STORE_KEY)
  location.replace(location.pathname)
}

/** Reads `#iroh=…&relay=…&pair=…`, stores the endpoint and keeps the pairing code for one redeem. */
export function takePairingFragment(): RemoteConfig | null {
  const h = new URLSearchParams(location.hash.slice(1))
  const endpointId = h.get('iroh')
  if (!endpointId || !/^[0-9a-f]{64}$/.test(endpointId)) return null
  const cfg: RemoteConfig = { endpointId, relayUrl: h.get('relay') || undefined }
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
  pendingPairCode = h.get('pair')
  history.replaceState(null, '', location.pathname + location.search)
  return cfg
}
export const consumePairCode = () => { const c = pendingPairCode; pendingPairCode = null; return c }

/** Is a backend answering on our own origin? (true when the backend serves this UI) */
export async function sameOriginBackend(): Promise<boolean> {
  try {
    const res = await fetch(new URL('api/health', location.href.replace(/[^/]*$/, '')), { credentials: 'same-origin' })
    return res.headers.get('content-type')?.includes('application/json') ?? false
  } catch { return false }
}

export async function connectIroh(cfg: RemoteConfig) {
  conn = { mode: 'iroh', base: IROH_ORIGIN, status: 'connecting', endpointId: cfg.endpointId, serviceWorker: false }
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
      const r = await iroh.serviceWorker({ url: new URL('iroh-sw.js', location.href.replace(/[^/]*$/, '')).pathname, hosts: [new URL(IROH_ORIGIN).host] })
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
