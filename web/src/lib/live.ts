// Keeps the /api/events stream (SSE) honest. A stream can look open and still deliver nothing: an iroh
// tunnel or proxy that lost its backend, a phone that suspended the app, a laptop that slept. And every
// reconnect can miss events. So:
//   - the backend sends `hello` (boot id, heartbeat interval) on connect and `ping` every heartbeat;
//     no event for three heartbeats = dead stream, replaced by a new one;
//   - a stream the browser gave up on (EventSource CLOSED, e.g. a 502 while the backend restarts behind
//     a tunnel) is reopened with backoff;
//   - after every reconnect, a new backend process (boot id), and whenever the app comes back to the
//     foreground or online, the store refetches its state (onResync) instead of trusting old events.
// Works the same with the browser's EventSource and with iroh-fetch's (same API).

export type Hello = { bootId: string; build: string | null; heartbeatMs: number; ts: number }
export type ResyncReason = 'reconnect' | 'restart' | 'visible' | 'pageshow' | 'focus' | 'online'

type Options = {
  url: () => string
  /** Named events and their handlers (data is the parsed JSON). */
  on: Record<string, (data: never) => void>
  /** Only (re)connect while this holds (e.g. logged in). */
  enabled: () => boolean
  onLive: (live: boolean) => void
  onHello?: (hello: Hello) => void
  /** Events may have been missed: refetch everything. */
  onResync: (why: ResyncReason) => void
}

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
const DEFAULT_HEARTBEAT_MS = 15000
const WATCH_MS = 5000
const HEALTHY_AFTER_MS = 20000 // a stream that stayed open this long resets the backoff

export class LiveEvents {
  #opts: Options
  #es: EventSource | null = null
  #hello: Hello | null = null
  #bootId: string | null = null
  #everOpened = false
  #openedAt = 0
  #lastSeen = 0 // any byte-level sign of life: open, hello, ping, or a real event
  #attempt = 0
  #retry: ReturnType<typeof setTimeout> | undefined
  #watch: ReturnType<typeof setInterval> | undefined
  #hiddenAt = 0
  #running = false
  #unlisten: (() => void) | null = null

  constructor(opts: Options) { this.#opts = opts }

  start() {
    this.stop()
    this.#running = true
    this.#everOpened = false
    this.#attempt = 0
    this.#connect()
    this.#watch = setInterval(() => this.#check(), WATCH_MS)
    this.#unlisten = this.#listen()
  }

  stop() {
    this.#running = false
    clearTimeout(this.#retry)
    clearInterval(this.#watch)
    this.#unlisten?.()
    this.#unlisten = null
    this.#es?.close()
    this.#es = null
  }

  /** Heartbeat interval announced by the backend (older backends send no hello). */
  get #heartbeat() { return this.#hello?.heartbeatMs || DEFAULT_HEARTBEAT_MS }

  #connect() {
    clearTimeout(this.#retry)
    this.#es?.close()
    this.#es = null
    if (!this.#running || !this.#opts.enabled()) return
    const es = new EventSource(this.#opts.url(), { withCredentials: true })
    this.#es = es
    this.#lastSeen = Date.now()
    const mine = (fn: () => void) => () => { if (this.#es === es) fn() }
    es.onopen = mine(() => {
      this.#lastSeen = this.#openedAt = Date.now()
      this.#opts.onLive(true)
      if (this.#everOpened) this.#opts.onResync('reconnect')
      this.#everOpened = true
    })
    es.onerror = mine(() => {
      this.#opts.onLive(false)
      // CONNECTING: the EventSource retries on its own. CLOSED: it gave up (HTTP error, wrong type).
      if (es.readyState === EventSource.CLOSED) this.#reconnectLater()
    })
    const listen = (name: string, fn: (data: never) => void) => es.addEventListener(name, (e) => {
      if (this.#es !== es) return
      this.#lastSeen = Date.now()
      let data: unknown
      try { data = JSON.parse((e as MessageEvent).data) } catch { return }
      fn(data as never)
    })
    listen('hello', (h: Hello) => {
      const restarted = this.#bootId !== null && this.#bootId !== h.bootId
      this.#hello = h
      this.#bootId = h.bootId
      this.#opts.onHello?.(h)
      if (restarted) this.#opts.onResync('restart')
    })
    listen('ping', () => {})
    for (const [name, fn] of Object.entries(this.#opts.on)) listen(name, fn)
  }

  #reconnectLater() {
    clearTimeout(this.#retry)
    this.#es?.close()
    this.#es = null
    const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]
    this.#attempt++
    this.#retry = setTimeout(() => this.#connect(), delay)
  }

  /** Reconnect right away (the app just became visible/online, or the stream went silent). */
  reconnectNow() {
    this.#attempt = 0
    this.#connect()
  }

  #stale(es: EventSource, now: number) {
    const silent = now - this.#lastSeen
    // Without a hello (older backend) pings are invisible comments: only a stuck connect counts.
    if (es.readyState === EventSource.OPEN) return !!this.#hello && silent > this.#heartbeat * 3
    return silent > this.#heartbeat * 3
  }

  #check() {
    if (!this.#running || !this.#es) return
    const now = Date.now()
    if (this.#es.readyState === EventSource.OPEN && now - this.#openedAt > HEALTHY_AFTER_MS) this.#attempt = 0
    if (this.#stale(this.#es, now)) {
      this.#opts.onLive(false)
      this.#attempt++
      this.#connect()
    }
  }

  /** The app is back (visible, restored from the back-forward cache, focused, online). */
  wake(why: ResyncReason) {
    if (!this.#running || !this.#opts.enabled()) return
    const now = Date.now()
    const es = this.#es
    const away = this.#hiddenAt ? now - this.#hiddenAt : 0
    // Suspended apps miss pings without noticing: anything quieter than one heartbeat is suspicious.
    const suspicious = !es || es.readyState !== EventSource.OPEN || now - this.#lastSeen > this.#heartbeat + 5000 || away > this.#heartbeat || why === 'online'
    if (suspicious) this.reconnectNow()
    this.#opts.onResync(why)
  }

  #listen() {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { this.#hiddenAt = Date.now(); return }
      this.wake('visible')
      this.#hiddenAt = 0
    }
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) this.wake('pageshow') }
    const onFocus = () => this.wake('focus')
    const onOnline = () => this.wake('online')
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }
}
