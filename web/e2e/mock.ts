// Answers every /api request of the built UI from the fixtures, so the tests need no backend and never
// reach Hermes. Writes (respond, send, move) succeed without effect.
import type { Page } from '@playwright/test'
import { IMAGE_SVG, INBOX_ITEMS, MESSAGES, NOW, OPEN, PASEO_AGENTS, PASEO_TIMELINE, SESSIONS } from './fixtures'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

export async function mockApi(page: Page, opts: { auth?: boolean; freezeClock?: boolean } = {}) {
  const auth = opts.auth ?? true
  // Frozen by default so relative times render the same; animations that read the clock need it running.
  if (opts.freezeClock ?? true) await page.clock.setFixedTime(NOW * 1000)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^.*\/api\//, '/api/')
    const method = route.request().method()
    if (p === '/api/health') return route.fulfill(json({ ok: true }))
    if (!auth && p !== '/api/login') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' })
    if (p === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 600000\n\nevent: gateway\ndata: {"connected":true}\n\n' })
    if (p === '/api/sessions' && method === 'GET') return route.fulfill(json({ sessions: SESSIONS, gateway: true }))
    if (p === '/api/inbox') return route.fulfill(json({ open: OPEN, items: INBOX_ITEMS, unread: 2, paseo: { connected: true, canRespond: true } }))
    if (p === '/api/remote') {
      return route.fulfill(json({
        local: true,
        remote: { mode: 'iroh', status: 'online', url: null, loginUrl: null, error: null, endpointId: 'f0a288fe0000000000000000000000000000', relayUrl: 'https://euw1-1.relay.n0.iroh.link', uiUrl: 'https://example.github.io/hermes-ui/' },
        devices: [
          { id: 'd1', name: 'iPhone · Safari', via: 'iroh', remote: true, irohId: 'ab12cd34ef', createdAt: (NOW - 86400) * 1000, lastSeen: (NOW - 120) * 1000, expiresAt: (NOW + 86400 * 80) * 1000 },
          { id: 'd2', name: 'Mac · Chrome', via: 'local', remote: false, createdAt: (NOW - 86400 * 3) * 1000, lastSeen: (NOW - 10) * 1000, expiresAt: (NOW + 86400 * 80) * 1000 },
        ],
      }))
    }
    if (p === '/api/push') return route.fulfill(json({ publicKey: 'BOGUS', subscriptions: [] }))
    if (p === '/api/search') {
      const q = url.searchParams.get('q') || ''
      const hit = (s: (typeof SESSIONS)[number], i: number) => ({ session: s, hit: { msgId: 4, role: i ? 'user' : 'assistant', ts: NOW - 3500, snippet: `… das \u0002${q}\u0003-Paket fehlt in package.json …`, hits: 2 } })
      return route.fulfill(json({ q, title: [{ session: SESSIONS[0] }], content: SESSIONS.slice(1, 4).map(hit) }))
    }
    if (p === '/api/file') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGE_SVG })
    const thread = p.match(/^\/api\/sessions\/([^/]+)$/)
    if (thread) {
      const s = SESSIONS.find((x) => x.id === decodeURIComponent(thread[1])) || SESSIONS[0]
      return route.fulfill(json({ session: s, messages: MESSAGES }))
    }
    if (/^\/api\/sessions\/[^/]+\/paseo$/.test(p)) return route.fulfill(json({ connected: true, source: 'paseo-mcp', agents: PASEO_AGENTS }))
    if (/^\/api\/paseo\/agents\/[^/]+\/timeline$/.test(p)) return route.fulfill(json(PASEO_TIMELINE))
    return route.fulfill(json({}))
  })
}
