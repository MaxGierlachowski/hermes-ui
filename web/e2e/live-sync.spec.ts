import { expect, test, type Page } from '@playwright/test'
import { mockApi } from './mock'
import { SESSIONS } from './fixtures'

// The board must never silently keep a stale state: after a reconnect, a backend restart, a stream that
// went silent, or the app coming back to the foreground it refetches everything. The backend is mocked:
// `server` is what the next request sees, each /api/events request is one short stream.

type Server = { bootId: string; heartbeatMs: number; retry: number; sessions: typeof SESSIONS; streams: number; sessionLoads: number; failStreams: number }

async function liveBoard(page: Page, patch: Partial<Server> = {}) {
  const server: Server = { bootId: 'boot-1', heartbeatMs: 15000, retry: 600000, sessions: SESSIONS.map((s) => ({ ...s })), streams: 0, sessionLoads: 0, failStreams: 0, ...patch }
  await mockApi(page, { freezeClock: false })
  // Registered after mockApi, so these win for their paths.
  await page.route((url) => url.pathname.endsWith('/api/events'), (route) => {
    server.streams++
    if (server.failStreams > 0) { server.failStreams--; return route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' }) }
    const hello = { bootId: server.bootId, build: null, heartbeatMs: server.heartbeatMs, ts: Date.now() }
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `retry: ${server.retry}\n\nevent: hello\ndata: ${JSON.stringify(hello)}\n\nevent: gateway\ndata: {"connected":true}\n\n` })
  })
  await page.route((url) => url.pathname.endsWith('/api/sessions'), (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    server.sessionLoads++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: server.sessions, gateway: true }) })
  })
  await page.goto('/#/board')
  await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
  await expect.poll(() => server.streams).toBeGreaterThan(0)
  return server
}

// Phone layout: one tab per column with its card count (New, Doing, Waiting, Done).
const waitingCount = (page: Page) => page.getByRole('tab').nth(2).locator('span.tabular-nums')
const everyoneDone = (server: Server) => { server.sessions = server.sessions.map((s) => ({ ...s, column: 'done' as const, autoColumn: 'done' as const, pending: [] })) }

async function setVisibility(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

test('a reconnect refetches the board: cards that left Waiting meanwhile do not stay there', async ({ page }) => {
  // Every stream ends at once and the browser reconnects after 300 ms, as after a backend restart.
  const server = await liveBoard(page, { retry: 300 })
  expect(Number(await waitingCount(page).textContent())).toBeGreaterThan(0)
  // The change happens while no stream delivers it (no `session` event is ever sent).
  everyoneDone(server)
  await expect(waitingCount(page)).toHaveText('0')
})

test('a new backend process (boot id) forces a resync', async ({ page }) => {
  const server = await liveBoard(page, { retry: 300 })
  const loads = server.sessionLoads
  everyoneDone(server)
  server.bootId = 'boot-2'
  await expect(waitingCount(page)).toHaveText('0')
  expect(server.sessionLoads).toBeGreaterThan(loads)
})

test('a stream the browser gave up on (502 behind a tunnel) is reopened with backoff and resyncs', async ({ page }) => {
  const server = await liveBoard(page, { retry: 300, failStreams: 0 })
  server.failStreams = 1 // the next reconnect gets a 502: EventSource goes CLOSED and never retries by itself
  everyoneDone(server)
  const streams = server.streams
  await expect.poll(() => server.streams, { timeout: 5000 }).toBeGreaterThan(streams + 1)
  await expect(waitingCount(page)).toHaveText('0')
})

test('a silent stream (no ping for three heartbeats) is replaced and the board resyncs', async ({ page }) => {
  // heartbeat 1 s: the stream ends after hello and the browser would only retry in 10 min.
  const server = await liveBoard(page, { heartbeatMs: 1000 })
  const streams = server.streams
  everyoneDone(server)
  await expect.poll(() => server.streams, { timeout: 12000 }).toBeGreaterThan(streams)
  await expect(waitingCount(page)).toHaveText('0', { timeout: 5000 })
})

test('coming back to the foreground refetches the board without a reload', async ({ page }) => {
  const server = await liveBoard(page)
  expect(Number(await waitingCount(page).textContent())).toBeGreaterThan(0)
  await setVisibility(page, 'hidden')
  everyoneDone(server)
  const streams = server.streams
  await setVisibility(page, 'visible')
  await expect(waitingCount(page)).toHaveText('0')
  // The ended stream (browser retry in 10 min) counts as dead: a new one is opened right away.
  expect(server.streams).toBeGreaterThan(streams)
})

test('a page restored from the back-forward cache resyncs too', async ({ page }) => {
  const server = await liveBoard(page)
  everyoneDone(server)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(waitingCount(page)).toHaveText('0')
})
