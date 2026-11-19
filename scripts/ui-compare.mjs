#!/usr/bin/env node
// Visual comparison of the two web UIs, screen by screen, with the same data: the shadcn web UI
// (web/dist) and the universal app's web build (app/dist-web). Both get the app's demo data
// (app/src/lib/demo.ts, bundled with esbuild) through a mocked /api, so titles, messages, prompts and
// timestamps are identical. Screenshots go to --out as <screen>-<viewport>-<theme>-<ui>.png, plus one
// side-by-side image per pair (<screen>-<viewport>-<theme>.png, shadcn left, universal right).
//
//   npm -w web run build && npm --prefix app run web:export
//   node scripts/ui-compare.mjs --out /tmp/ui-compare [--only board,thread] [--engine chromium|webkit] [--ui both|shadcn|universal]
//
// It serves both builds itself (ports 8812 shadcn, 8811 universal, index.html fallback). docs/ui-audit.md has the findings.
import { chromium, webkit } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const OUT = path.resolve(arg('out', '/tmp/ui-compare'))
const ONLY = arg('only', '') ? new Set(arg('only').split(',')) : null
const ENGINE = arg('engine', 'chromium')
const WHICH = arg('ui', 'both')
const THEMES = (arg('themes', 'light,dark')).split(',')

// ---------- demo data: the app's DemoBackend, bundled for node ----------
async function loadDemo() {
  const require = createRequire(path.join(ROOT, 'desktop-app/package.json'))
  const esbuild = require('esbuild')
  const stubs = {
    'expo-file-system': 'export class File { constructor() {} }',
    './i18n': 'export const lang = "en"',
  }
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'app/src/lib/demo.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^(expo-file-system|\.\/i18n)$/ }, (a) => ({ path: a.path, namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }))
      },
    }],
  })
  const file = path.join(OUT, '.demo.mjs')
  await writeFile(file, out.outputFiles[0].text)
  return import(file)
}

// ---------- static servers ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' }
function serve(dir, port) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x')
      let file = path.join(dir, decodeURIComponent(url.pathname))
      try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html') } catch { file = path.join(dir, 'index.html') }
      try {
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(body)
      } catch { res.writeHead(404); res.end() }
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// ---------- the mocked backend ----------
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
async function mock(page, demo, variant) {
  const backend = new demo.DemoBackend({})
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    const p = url.pathname
    if (p === '/api/health') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, gateway: true }) })
    if (p === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: cors, body: 'retry: 600000\n\nevent: gateway\ndata: {"connected":true}\n\n' })
    if (p.startsWith('/api/media/')) {
      const uri = backend.mediaUrl('/api/media/demo/build-error.jpg')
      return route.fulfill({ status: 200, headers: cors, contentType: 'image/jpeg', body: Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64') })
    }
    if (p === '/api/remote') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ local: true, remote: { mode: 'off', status: 'off', url: null, loginUrl: null, error: null }, devices: [] }) })
    if (p === '/api/push') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ publicKey: 'BOGUS', subscriptions: [] }) })
    if (variant === 'empty' && p === '/api/sessions' && req.method() === 'GET') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sessions: [], gateway: true }) })
    if (variant === 'error' && p === '/api/sessions') return route.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'Hermes gateway is not reachable' }) })
    let json
    try { json = req.postData() ? JSON.parse(req.postData()) : undefined } catch { json = undefined }
    const r = await backend.fetch(p + url.search, { method: req.method(), json })
    return route.fulfill({ status: r.status, headers: cors, contentType: 'application/json', body: await r.text() })
  })
}

// ---------- screens ----------
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } }
const T = {
  site: 'Fix the landing page build and deploy it',
  release: 'Prepare release 1.4',
  weekly: 'Summarise the week for the team',
}
const wait = (page, ms = 500) => page.waitForTimeout(ms)
const clickText = async (page, text) => { await page.getByText(text, { exact: true }).first().click(); await wait(page, 900) }
const tab = async (page, name) => { await page.getByRole('tab', { name }).first().click(); await wait(page, 700) }

// Each screen: viewports it makes sense for, and how to get there in each UI.
const SCREENS = {
  board: { vp: ['desktop', 'tablet', 'phone'], go: async () => {} },
  'board-empty': { vp: ['desktop', 'phone'], variant: 'empty', go: async () => {} },
  'board-error': { vp: ['desktop'], variant: 'error', go: async () => {} },
  thread: { vp: ['desktop', 'phone'], go: (page) => clickText(page, T.site) },
  'thread-top': {
    vp: ['desktop', 'phone'],
    go: async (page) => {
      await clickText(page, T.site)
      // Every scroll area to its top (a column-reverse thread clamps the negative value to its top too).
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('*')) {
          const st = getComputedStyle(el)
          if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) el.scrollTop = st.flexDirection === 'column-reverse' ? -1e6 : 0
        }
      })
      await wait(page, 600)
    },
  },
  clarify: { vp: ['desktop', 'phone'], go: (page) => clickText(page, T.release) },
  markdown: { vp: ['desktop'], go: (page) => clickText(page, T.weekly) },
  inbox: { vp: ['desktop', 'phone'], go: (page) => tab(page, /Inbox/) },
  search: {
    vp: ['desktop'],
    go: async (page) => { await page.keyboard.press('Meta+k'); await wait(page, 400); await page.keyboard.type('release'); await wait(page, 800) },
  },
  'new-chat': {
    vp: ['desktop'],
    go: async (page) => { await page.locator('body').click({ position: { x: 700, y: 880 } }).catch(() => {}); await page.keyboard.press('n'); await wait(page, 600) },
  },
  menu: { vp: ['desktop'], go: async (page) => { await page.getByText('Daily summary', { exact: true }).first().click({ button: 'right' }); await wait(page, 500) } },
  tooltip: {
    vp: ['desktop'],
    go: async (page) => {
      const btn = page.getByRole('button', { name: /Einstellungen|Settings|Neuer Chat|New chat/ }).first()
      await btn.hover(); await wait(page, 1200)
    },
  },
}

// ---------- side-by-side ----------
async function sideBySide(browser, a, b, out, label) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
  const [ia, ib] = await Promise.all([readFile(a), readFile(b)].map((p) => p.then((x) => x.toString('base64'))))
  await page.setContent(`<html><body style="margin:0;background:#888;font:600 14px system-ui;display:flex;gap:8px;padding:8px">
    <figure style="margin:0"><figcaption style="padding:4px">shadcn web (reference) · ${label}</figcaption><img src="data:image/png;base64,${ia}" style="display:block;max-width:none"></figure>
    <figure style="margin:0"><figcaption style="padding:4px">universal app · ${label}</figcaption><img src="data:image/png;base64,${ib}" style="display:block;max-width:none"></figure></body></html>`)
  await page.waitForLoadState('load')
  await page.screenshot({ path: out, fullPage: true })
  await page.close()
}

// ---------- run ----------
await mkdir(OUT, { recursive: true })
const demo = await loadDemo()
const servers = []
if (WHICH !== 'universal') servers.push(await serve(path.join(ROOT, 'web/dist'), 8812))
if (WHICH !== 'shadcn') servers.push(await serve(path.join(ROOT, 'app/dist-web'), 8811))
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch()
const UIS = { shadcn: 'http://127.0.0.1:8812', universal: 'http://127.0.0.1:8811' }
const shots = []
for (const [name, screen] of Object.entries(SCREENS)) {
  if (ONLY && !ONLY.has(name)) continue
  for (const vp of screen.vp) for (const theme of THEMES) {
    const files = {}
    for (const ui of Object.keys(UIS)) {
      if (WHICH !== 'both' && WHICH !== ui) continue
      const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], colorScheme: theme, locale: 'en-GB', deviceScaleFactor: vp === 'phone' ? 2 : 1, hasTouch: vp === 'phone', isMobile: vp === 'phone' && ENGINE === 'chromium' })
      await ctx.addInitScript(([ui, base, theme]) => {
        localStorage.setItem('hk_lang', 'en')
        localStorage.setItem('hk_tab', 'board')
        if (ui === 'universal') localStorage.setItem('hermes-ui.target', JSON.stringify({ kind: 'http', baseUrl: base, token: 'compare' }))
        localStorage.setItem('hk_theme', theme); localStorage.setItem('theme', theme)
      }, [ui, UIS[ui], theme])
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await mock(page, demo, screen.variant)
      await page.goto(UIS[ui] + '/', { waitUntil: 'networkidle' }).catch(() => {})
      await wait(page, 1200)
      try { await screen.go(page, ui) } catch (e) { errors.push(`navigation: ${e.message.split('\n')[0]}`) }
      const file = path.join(OUT, `${name}-${vp}-${theme}-${ui}.png`)
      await page.screenshot({ path: file })
      files[ui] = file
      if (errors.length) console.log(`  ${name}/${vp}/${theme}/${ui}: ${errors.join(' | ').slice(0, 300)}`)
      await ctx.close()
    }
    if (files.shadcn && files.universal) {
      const pair = path.join(OUT, `${name}-${vp}-${theme}.png`)
      await sideBySide(browser, files.shadcn, files.universal, pair, `${name} · ${vp} · ${theme}`)
      shots.push(pair)
    }
    console.log(`${name} ${vp} ${theme}`)
  }
}
await browser.close()
servers.forEach((s) => s.close())
console.log(`${shots.length} pairs in ${OUT}`)
