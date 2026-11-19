// expo-iroh: HTTP over iroh to an iroh-bridge gateway (iroh-http/1), from a native Rust client.
//
//   const iroh = await IrohBackend.connect({ endpointId, relayUrl }, { secretKey })
//   const res = await iroh.fetch('/api/sessions')          // fetch-like: status, ok, json(), text()
//   const stop = iroh.events('/api/events', (e) => …)      // Server-Sent Events, reconnects itself
//   await iroh.download('/api/media/…', fileUri)            // bodies straight into a file (images, audio)
//
// The app code works as if against an HTTP base URL; only paths reach the backend.
import { SseParser } from '../../../shared/sse'
import Native, { type HeaderPairs } from './src/ExpoIrohModule'

export { default as ExpoIrohNative } from './src/ExpoIrohModule'

export type Gateway = { endpointId: string; relayUrl?: string }
export type ConnectionPath = { kind: 'direct' | 'relay' | 'none'; paths: { kind: string; addr: string; selected: boolean; rttMs: number }[] }

export type IrohRequestInit = {
  method?: string
  headers?: Record<string, string>
  /** JSON-serialisable value: sent as application/json. */
  json?: unknown
  body?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export class IrohResponse {
  constructor(private id: number, readonly status: number, readonly headers: HeaderPairs) {}
  get ok() { return this.status >= 200 && this.status < 300 }
  header(name: string) {
    const n = name.toLowerCase()
    return this.headers.find(([k]) => k.toLowerCase() === n)?.[1] ?? null
  }
  text() { return Native.text(this.id) }
  async json<T = unknown>(): Promise<T> { return JSON.parse(await this.text()) as T }
  /** Next decoded text chunk, or null at the end. */
  readText() { return Native.readText(this.id) }
  read() { return Native.read(this.id) }
  cancel() { Native.cancel(this.id) }
}

export class IrohError extends Error {
  constructor(message: string, readonly kind: 'network' | 'timeout' | 'aborted' = 'network') { super(message) }
}

const toError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  return new IrohError(msg, /timed out/.test(msg) ? 'timeout' : 'network')
}

export class IrohBackend {
  private constructor(readonly gateway: Gateway, readonly endpointId: string, readonly secretKey: string) {}

  static libraryInfo() { return Native.libraryInfo() }

  /**
   * Creates (once per process) the local endpoint with `secretKey` (keep it in the keystore; without
   * one a new identity is made) and dials the gateway. Resolves once connected or after `timeoutMs`.
   */
  static async connect(gateway: Gateway, opts: { secretKey?: string | null; relayUrl?: string | null; timeoutMs?: number; lazy?: boolean } = {}) {
    const { endpointId, secretKey } = await Native.create(opts.relayUrl ?? null, opts.secretKey ?? null)
    const backend = new IrohBackend(gateway, endpointId, secretKey)
    if (!opts.lazy) {
      try { await Native.connect(gateway.endpointId, gateway.relayUrl ?? null, opts.timeoutMs ?? 20_000) } catch (e) { throw toError(e) }
    }
    return backend
  }

  /** Dials the gateway now (requests also dial on demand); rejects after `timeoutMs`. */
  async dial(timeoutMs = 20_000) {
    try { await Native.connect(this.gateway.endpointId, this.gateway.relayUrl ?? null, timeoutMs) } catch (e) { throw toError(e) }
  }

  async fetch(path: string, init: IrohRequestInit = {}): Promise<IrohResponse> {
    const headers: HeaderPairs = Object.entries(init.headers || {})
    let body = init.body ?? null
    if (init.json !== undefined) {
      body = JSON.stringify(init.json)
      if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['content-type', 'application/json'])
    }
    if (init.signal?.aborted) throw new IrohError('aborted', 'aborted')
    let head
    try {
      head = await Native.request({
        remote: this.gateway.endpointId, relay: this.gateway.relayUrl ?? null,
        method: init.method || (body != null ? 'POST' : 'GET'), path, headers, body, timeoutMs: init.timeoutMs ?? 30_000,
      })
    } catch (e) { throw toError(e) }
    const res = new IrohResponse(head.id, head.status, head.headers)
    if (init.signal) {
      if (init.signal.aborted) res.cancel()
      else init.signal.addEventListener('abort', () => res.cancel(), { once: true })
    }
    return res
  }

  /** Writes the body of GET `path` to `fileUri` (file://…); resolves with the status. */
  async download(path: string, fileUri: string, timeoutMs = 60_000) {
    try {
      return await Native.download({ remote: this.gateway.endpointId, relay: this.gateway.relayUrl ?? null, path, timeoutMs }, fileUri)
    } catch (e) { throw toError(e) }
  }

  /**
   * Follows a Server-Sent-Events stream; reconnects with backoff (1 s → 15 s) when it breaks.
   * Returns a stop function. `onState(true)` once the stream is open, `false` when it broke.
   */
  events(path: string, onEvent: (event: string, data: string) => void, onState?: (open: boolean) => void) {
    let stopped = false
    let current: IrohResponse | null = null
    let delay = 1000
    const run = async () => {
      while (!stopped) {
        try {
          const res = await this.fetch(path, { headers: { accept: 'text/event-stream' }, timeoutMs: 20_000 })
          if (!res.ok) throw new IrohError(`HTTP ${res.status}`)
          current = res
          delay = 1000
          onState?.(true)
          const parser = new SseParser((e) => onEvent(e.event, e.data))
          for (;;) {
            const chunk = await res.readText()
            if (chunk == null || stopped) break
            parser.push(chunk)
          }
        } catch { /* reconnect below */ }
        current = null
        if (stopped) break
        onState?.(false)
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 15_000)
      }
    }
    run()
    return () => { stopped = true; current?.cancel() }
  }

  /** The path in use right now: direct (hole-punched UDP) or via the relay, with RTTs. */
  connectionInfo(): ConnectionPath | null {
    const raw = Native.connectionInfo(this.gateway.endpointId)
    return raw ? (JSON.parse(raw) as ConnectionPath) : null
  }

  relayProblem() { return Native.relayProblem() }

  /** Closes the endpoint (all connections). A later connect() creates it again. */
  static close() { return Native.close() }
}

/**
 * Android: keeps the app process alive in the background through a foreground service (a quiet
 * ongoing notification), so the connection keeps delivering. No-ops elsewhere. Start it while the
 * app is in the foreground; Android does not allow starting it from the background.
 */
export const KeepAlive = {
  start: (title: string, text: string) => Native.startKeepAlive?.(title, text) ?? false,
  update: (title: string, text: string) => Native.updateKeepAlive?.(title, text),
  stop: () => Native.stopKeepAlive?.(),
  /** False once the system stopped it (e.g. Android 15's 6-hour limit for dataSync services). */
  isRunning: () => Native.keepAliveRunning?.() ?? false,
}
