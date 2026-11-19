#!/usr/bin/env node
// Measures the two web UIs side by side with identical data: the shadcn web UI (web/dist) and the
// universal app's web build (app/dist-web). Every /api request is answered in the browser from
// generated data (no backend, no latency), so the numbers compare rendering, not the network.
//
//   node scripts/measure-ui.mjs --shadcn http://127.0.0.1:8812 --universal http://127.0.0.1:8811 [--engine chromium|webkit] [--runs 3]
//
// Serve the two builds statically first (any static server with an index.html fallback).
// Prints one JSON line per UI; docs/decisions/0012-universal-app.md has the results. Card clicks are DOM clicks:
// in WebKit the shadcn board's cards never count as "stable" for Playwright (dnd-kit transforms).
import { chromium, webkit } from '@playwright/test'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const ENGINE = arg('engine', 'chromium')
const RUNS = Number(arg('runs', 3))
const LONG = Number(arg('long', 450))
const NOW = Math.floor(Date.now() / 1000)

// ---------- data ----------
const COLS = ['new', 'doing', 'waiting', 'done']
const session = (i) => ({
  id: `s${i}`, title: `Session ${i}: ${['Fix the build', 'Compare databases', 'Release notes', 'Weekly report'][i % 4]}`, source: 'desktop', system: false,
  column: COLS[i % 4], autoColumn: COLS[i % 4], override: false, running: i % 4 === 1, activity: i % 4 === 1 ? 'Reading files …' : '', initialPrompt: '',
  createdAt: NOW - 7200 - i * 60, updatedAt: NOW - i * 60, messageCount: 12, test: false, pending: [], paseo: [], paseoNote: '',
})
const SESSIONS = Array.from({ length: 40 }, (_, i) => session(i))
SESSIONS.push({ ...session(99), id: 'long', title: `Long thread (${LONG} messages)`, column: 'waiting', autoColumn: 'waiting', updatedAt: NOW, messageCount: LONG })
const md = [
  'Here is the plan for this step:\n\n1. Read the config\n2. Change the **retry policy**\n3. Run the tests\n\n```ts\nexport const retry = { attempts: 5, backoffMs: 250 }\n```',
  'Done. The tests pass (128 of 128). Next I look at the logging, which still writes every request twice.',
  '| Check | Result |\n|---|---|\n| Lint | ok |\n| Types | ok |\n| Unit tests | 128 / 128 |',
]
const thread = (n, tag) => Array.from({ length: n }, (_, i) => {
  const ts = NOW - (n - i) * 60
  if (i === n - 1) return { id: i + 1, role: 'assistant', ts, text: `Last message ${tag}` }
  const k = i % 5
  if (k === 0) return { id: i + 1, role: 'user', ts, text: `Step ${i / 5 + 1}: please continue with the next part.` }
  if (k === 1 || k === 3) return { id: i + 1, role: 'tool', ts, toolName: k === 1 ? 'terminal' : 'read_file', summary: k === 1 ? 'npm test' : 'src/retry.ts', text: k === 1 ? '$ npm test\n128 passing' : '' }
  return { id: i + 1, role: 'assistant', ts, text: md[i % md.length] }
})
const INBOX = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, kind: 'done', source: 'hermes', sessionId: `s${i}`, title: SESSIONS[i].title, text: `Inbox entry ${i}`, at: NOW - i * 300, read: i > 3 }))

const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) })
async function mock(page) {
  await page.route('**/api/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const url = new URL(req.url())
    const p = url.pathname
    if (p === '/api/health') return route.fulfill(json({ ok: true, gateway: true }))
    if (p === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: 'retry: 600000\n\nevent: gateway\ndata: {"connected":true}\n\n' })
    if (p === '/api/sessions' && req.method() === 'GET') return route.fulfill(json({ sessions: SESSIONS, gateway: true }))
    if (p === '/api/remote') return route.fulfill(json({ local: true, remote: { mode: 'off', status: 'off', url: null, loginUrl: null, error: null }, devices: [] }))
    if (p === '/api/push') return route.fulfill(json({ publicKey: 'BOGUS', subscriptions: [] }))
    if (p === '/api/inbox') return route.fulfill(json({ open: [], items: INBOX, unread: 4, paseo: { connected: false, canRespond: false } }))
    const m = p.match(/^\/api\/sessions\/([^/]+)$/)
    if (m) {
      const id = decodeURIComponent(m[1])
      return route.fulfill(json({ session: SESSIONS.find((s) => s.id === id), messages: id === 'long' ? thread(LONG, id) : thread(12, id) }))
    }
    return route.fulfill(json({}))
  })
}

// ---------- UI specifics ----------
const UIS = {
  shadcn: {
    url: arg('shadcn', 'http://127.0.0.1:8812'),
    async prepare() {},
    inbox: (page) => step('click inbox tab', () => page.getByRole('tab', { name: /Inbox/ }).first().evaluate((el) => el.click())),
    board: (page) => step('click board tab', () => page.getByRole('tab', { name: /Board/ }).first().evaluate((el) => el.click())),
    threadSelector: '[data-slot="chat-container"], main',
  },
  universal: {
    url: arg('universal', 'http://127.0.0.1:8811'),
    // The universal web build reaches the (mocked) backend over its local-HTTP transport.
    async prepare(context, url) {
      await context.addInitScript((base) => { if (!localStorage.getItem('hermes-ui.target')) localStorage.setItem('hermes-ui.target', JSON.stringify({ kind: 'http', baseUrl: base, token: 'measure' })) }, url)
    },
    // A DOM click like for shadcn: Playwright's click() adds its actionability waits (~70 ms) to the time.
    inbox: (page) => page.getByRole('tab', { name: /Inbox/ }).first().evaluate((el) => el.click()),
    board: (page) => page.getByRole('tab', { name: /Board/ }).first().evaluate((el) => el.click()),
  },
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]) }
const since = (t0) => Math.round(performance.now() - t0)

async function scrollFps(page, marker) {
  // Wheel events at 60 Hz for 3 s over the thread (upwards), frames counted with rAF in the page.
  const box = await page.getByText(marker).boundingBox()
  await page.mouse.move(box.x + 20, box.y - 80)
  await page.evaluate(() => {
    window.__frames = []
    const loop = (t) => { window.__frames.push(t); if (window.__frames.length < 100000 && !window.__stop) requestAnimationFrame(loop) }
    window.__stop = false
    requestAnimationFrame(loop)
  })
  const t0 = performance.now()
  while (performance.now() - t0 < 3000) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16) }
  return page.evaluate(() => {
    window.__stop = true
    const f = window.__frames
    const gaps = f.slice(1).map((t, i) => t - f[i])
    const dur = (f[f.length - 1] - f[0]) / 1000
    return { fps: Math.round((f.length - 1) / dur), jank50: gaps.filter((g) => g > 50).length, maxFrameMs: Math.round(Math.max(...gaps)) }
  })
}

/** Waits (polling every animation frame) until `text` is on screen; resolves to the page's
 * performance.now() at that moment (ms since navigation start). Playwright's own waitFor polls with
 * back-off (up to 500 ms) and would blur the numbers. */
const seen = (page, text) => page.waitForFunction((t) => (document.body?.innerText.includes(t) ? performance.now() : false), text, { polling: 'raf', timeout: 30000 }).then((h) => h.jsonValue())

async function step(label, fn) {
  try { return await fn() } catch (e) { throw new Error(`${label}: ${e.message.split('\n')[0]}`) }
}

async function run(name) {
  const ui = UIS[name]
  const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch()
  const r = { cold: [], warm: [], openCold: [], openWarm: [], tab: [], openLong: [], fps: null }
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', serviceWorkers: 'block' })
    await ui.prepare(context, ui.url)
    const page = await context.newPage()
    await mock(page)
    await page.goto(ui.url, { waitUntil: 'commit' })
    // In-page time since navigation start, when the first card is on screen.
    r.cold.push(await step('board', () => seen(page, 'Session 0: Fix the build')))
    // Warm start: reload with the browser cache (and, in the universal app, its IndexedDB cache).
    await page.reload({ waitUntil: 'commit' })
    r.warm.push(await step('board (warm)', () => seen(page, 'Session 0: Fix the build')))
    await page.waitForTimeout(400)
    // Open a chat (first time, then again).
    let t0 = performance.now()
    await step('click Session 6: Release notes', () => page.getByText('Session 6: Release notes').first().evaluate((el) => el.click()))
    await step('open chat', () => seen(page, 'Last message s6'))
    r.openCold.push(since(t0))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await step('click Session 5: Compare databases', () => page.getByText('Session 5: Compare databases').first().evaluate((el) => el.click())); await step('w2 Last message s5', () => seen(page, 'Last message s5'))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    t0 = performance.now()
    await step('click Session 6: Release notes', () => page.getByText('Session 6: Release notes').first().evaluate((el) => el.click()))
    await step('w3 Last message s6', () => seen(page, 'Last message s6'))
    r.openWarm.push(since(t0))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    // Board → Inbox → Board (skipped where the tab cannot be driven, reported as null).
    try {
      t0 = performance.now()
      await step('inbox', async () => { await ui.inbox(page); await seen(page, 'Inbox entry 3') })
      await ui.board(page); await step('board again', () => seen(page, 'Session 0: Fix the build'))
      r.tab.push(since(t0))
    } catch (e) { console.error(`[${name}/${ENGINE}] ${e.message}`); await ui.board(page).catch(() => {}) }
    // The long thread: time until its newest message shows, then scrolling.
    t0 = performance.now()
    await step('click ^Long thread', () => page.getByText(/^Long thread/).first().evaluate((el) => el.click()))
    await step('w6 Last message long', () => seen(page, 'Last message long'))
    r.openLong.push(since(t0))
    if (i === RUNS - 1) { await page.waitForTimeout(1500); r.fps = await scrollFps(page, 'Last message long') }
    if (ENGINE === 'chromium' && i === RUNS - 1) r.heapMB = Math.round((await page.evaluate(() => performance.memory?.usedJSHeapSize || 0)) / 1048576)
    await context.close()
  }
  await browser.close()
  return { ui: name, engine: ENGINE, runs: RUNS, coldMs: median(r.cold), warmMs: median(r.warm), openChatColdMs: median(r.openCold), openChatWarmMs: median(r.openWarm), boardInboxBoardMs: r.tab.length ? median(r.tab) : null, openLongMs: median(r.openLong), scroll: r.fps, heapMB: r.heapMB }
}

for (const name of (arg('ui', 'shadcn,universal')).split(',')) {
  try { console.log(JSON.stringify(await run(name))) } catch (e) { console.log(JSON.stringify({ ui: name, engine: ENGINE, error: e.message.split('\n')[0] })) }
}
process.exit(0)
