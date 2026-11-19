// Web + desktop transport. Two ways to reach the backend:
//
//   - kind 'http': plain HTTP to a backend on this machine (127.0.0.1). The desktop app's default:
//     the Tauri shell starts the backend as a sidecar (or knows a running one) and hands over URL +
//     token. No iroh, no relay; the backend allows the app's origin through CORS.
//   - kind 'iroh': iroh-fetch (WASM) through an iroh relay, exactly like the shadcn web UI on a static
//     host. The pairing link (#iroh=…&relay=…&pair=…) is the same as for the phone.
//
// Where the choice is kept: the macOS Keychain in the desktop app (desktop.web.ts), localStorage in a
// browser. Native: transport.ts.
import { SseParser } from '@shared/sse'
import type { Backend, ConnectionPath } from './connection'
import { invoke, isDesktop, localBackend } from './desktop.web'

export type Target = { kind?: 'iroh'; endpointId: string; relayUrl?: string } | { kind: 'http'; baseUrl: string; token: string }

const KEY = 'hermes-ui.target'

class TransportError extends Error {
  constructor(message: string, readonly kind: 'network' | 'timeout' | 'aborted' = 'network') { super(message) }
}

async function secretGet(key: string) {
  if (isDesktop) return invoke<string | null>('secret_get', { key })
  try { return localStorage.getItem(key) } catch { return null }
}
async function secretSet(key: string, value: string) {
  if (isDesktop) { await invoke('secret_set', { key, value }); return }
  localStorage.setItem(key, value)
}
async function secretDelete(key: string) {
  if (isDesktop) { await invoke('secret_delete', { key }); return }
  localStorage.removeItem(key)
}

export async function savedTarget(): Promise<Target | null> {
  try { return JSON.parse((await secretGet(KEY)) || 'null') } catch { return null }
}

/**
 * The saved choice, else the backend the desktop shell runs (sidecar) or was configured with. The
 * shell's answer waits until its sidecar is up, so the first request after launch already succeeds;
 * its token wins over a saved one for the same URL (the sidecar's data dir may have been reset).
 */
export async function activeTarget(): Promise<Target | null> {
  const [saved, local] = await Promise.all([savedTarget(), localBackend()])
  if (local && (!saved || (saved.kind === 'http' && saved.baseUrl === local.baseUrl))) return { kind: 'http', baseUrl: local.baseUrl, token: local.token }
  return saved
}

export const rememberTarget = (t: Target) => secretSet(KEY, JSON.stringify(t))
export async function forgetTarget() {
  await secretDelete(KEY)
  // Desktop: stop the built-in backend too, or the next start would connect to it again.
  if (isDesktop) await invoke('set_backend_mode', { mode: 'off' })
}

/** Desktop app: start the bundled backend (sidecar) and return how to reach it. */
export async function startBuiltInBackend(): Promise<Target> {
  const b = await invoke<{ baseUrl: string; token: string }>('set_backend_mode', { mode: 'sidecar' })
  if (!b) throw new Error('The built-in backend did not start (see backend.log in the app data folder).')
  return { kind: 'http', baseUrl: b.baseUrl, token: b.token }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** fetch-based transport: one HTTP request per call, SSE read from the response stream. */
class HttpBackend implements Backend {
  readonly gateway: { endpointId: string; relayUrl?: string }
  private rtt = 0
  constructor(private base: string, private token: string | null, private doFetch: FetchFn, readonly endpointId: string, gateway: { endpointId: string; relayUrl?: string }, private media?: (path: string) => Promise<string>) {
    this.gateway = gateway
  }

  private headers(json: boolean, extra: Record<string, string> = {}) {
    return { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}), ...extra }
  }

  async fetch(path: string, init: { method?: string; json?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new TransportError('timed out', 'timeout')), init.timeoutMs ?? 30_000)
    init.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
    const t0 = performance.now()
    let res: Response
    try {
      res = await this.doFetch(this.base + path, {
        method: init.method || (init.json !== undefined ? 'POST' : 'GET'),
        headers: this.headers(init.json !== undefined),
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        signal: ctrl.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      throw new TransportError(e instanceof Error ? e.message : String(e), ctrl.signal.aborted ? 'timeout' : 'network')
    }
    this.rtt = performance.now() - t0
    return {
      status: res.status,
      ok: res.ok,
      text: async () => { try { return await res.text() } finally { clearTimeout(timer) } },
      cancel: () => { clearTimeout(timer); ctrl.abort() },
    }
  }

  /** Server-Sent Events over fetch (headers work, unlike EventSource); reconnects 1 s → 15 s. */
  events(path: string, onEvent: (event: string, data: string) => void, onState?: (open: boolean) => void) {
    let stopped = false
    let ctrl: AbortController | null = null
    let delay = 1000
    const run = async () => {
      while (!stopped) {
        ctrl = new AbortController()
        try {
          const res = await this.doFetch(this.base + path, { headers: this.headers(false, { accept: 'text/event-stream' }), signal: ctrl.signal })
          if (!res.ok || !res.body) throw new TransportError(`HTTP ${res.status}`)
          delay = 1000
          onState?.(true)
          const parser = new SseParser((e) => onEvent(e.event, e.data))
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          for (;;) {
            const { value, done } = await reader.read()
            if (done || stopped) break
            parser.push(value)
          }
        } catch { /* reconnect below */ }
        if (stopped) break
        onState?.(false)
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 15_000)
      }
    }
    run()
    return () => { stopped = true; ctrl?.abort() }
  }

  mediaUrl(path: string) {
    if (this.media) return this.media(path)
    // <img>/<audio> cannot send a header; the backend also takes the token as a query parameter.
    return `${this.base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token || '')}`
  }

  connectionInfo(): ConnectionPath {
    return { kind: 'direct', paths: [{ kind: this.token ? 'http' : 'relay', addr: this.gateway.endpointId, selected: true, rttMs: this.rtt }] }
  }
  relayProblem() { return null }
}

// iroh-fetch is loaded as a native ES module from /vendor (copied there at build time, see
// scripts/web-vendor.mjs): it finds its WASM through import.meta.url, which Metro does not bundle.
// A <script type="module"> tag rather than import(): no eval, fine under a strict CSP.
type IrohFetchModule = { createIrohFetch(o: Record<string, unknown>): Promise<{ fetch: FetchFn; objectUrl(u: string): Promise<string>; endpointId: string; close(): Promise<void> }> }
let irohModule: Promise<IrohFetchModule> | null = null
const loadIrohFetch = () => (irohModule ??= new Promise((resolve, reject) => {
  const w = window as unknown as { __irohFetch?: IrohFetchModule }
  if (w.__irohFetch) return resolve(w.__irohFetch)
  window.addEventListener('iroh-fetch-ready', () => resolve(w.__irohFetch!), { once: true })
  const s = document.createElement('script')
  s.type = 'module'
  s.src = new URL('vendor/iroh-loader.mjs', document.baseURI).href
  s.onerror = () => { irohModule = null; reject(new TransportError('iroh-fetch could not be loaded')) }
  document.head.appendChild(s)
}))
const IROH_ORIGIN = 'https://hermes-ui.iroh'
let iroh: Awaited<ReturnType<IrohFetchModule['createIrohFetch']>> | null = null

export async function openTransport(target: Target, timeoutMs: number): Promise<Backend> {
  if (target.kind === 'http') {
    const base = target.baseUrl.replace(/\/$/, '')
    return new HttpBackend(base, target.token, (u, i) => fetch(u, i), 'HTTP · 127.0.0.1', { endpointId: base })
  }
  await closeTransport()
  const { createIrohFetch } = await loadIrohFetch()
  iroh = await createIrohFetch({
    backends: { [IROH_ORIGIN]: target.relayUrl ? { endpointId: target.endpointId, relayUrl: target.relayUrl } : target.endpointId },
    persistIdentity: true, // stable device id: the gateway's allow-list knows this device
    connectTimeout: timeoutMs,
  })
  const client = iroh
  return new HttpBackend(IROH_ORIGIN, null, client.fetch.bind(client), client.endpointId, { endpointId: target.endpointId, relayUrl: target.relayUrl }, (p) => client.objectUrl(IROH_ORIGIN + p))
}

export async function closeTransport() {
  const c = iroh
  iroh = null
  await c?.close().catch(() => {})
}

export const isTransportError = (e: unknown) => e instanceof TransportError
export const deviceName = () => `${isDesktop ? 'Desktop app' : 'Browser'} · Hermes UI`
export const libraryInfo = () => (isDesktop ? 'Hermes UI desktop (Tauri 2) · web transport' : 'Hermes UI web (react-native-web) · fetch / iroh-fetch WASM')
