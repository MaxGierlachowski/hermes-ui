#!/usr/bin/env node
// Assembles the GitHub Pages site in _site/ (used by .github/workflows/pages.yml, runnable locally):
//
//   /              landing page (landing/)
//   /app/          the web UI (web/dist, built with VITE_SW_PATH='../')
//   /sw.js         the UI's service worker, kept at the root where installs from before the landing
//                  page registered it, so they keep their registration and Web Push subscription
//   /iroh-sw.js    imported by sw.js
//   /privacy/ …    static pages from site/, if that directory exists
//
// Usage: node scripts/build-pages.mjs [--skip-build] [--out <dir>]

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const out = path.resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : '_site')
const dist = path.join(root, 'web/dist')

if (!args.includes('--skip-build')) {
  const r = spawnSync('npm', ['--prefix', 'web', 'run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_SW_PATH: '../' } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('web/dist is missing; build the web UI first')

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// The UI under /app/. Its worker lives at the root (below), so the copies next to it are dropped.
fs.cpSync(dist, path.join(out, 'app'), { recursive: true })
for (const f of ['sw.js', 'iroh-sw.js']) fs.rmSync(path.join(out, 'app', f), { force: true })

// Root files: the worker (told where the UI is), the iroh bridge it imports, the icons the landing
// page, notifications and older installs use.
fs.writeFileSync(path.join(out, 'sw.js'), `self.HERMES_UI_APP_PATH = 'app/'\n${fs.readFileSync(path.join(dist, 'sw.js'), 'utf8')}`)
const generated = new Set(['app', 'sw.js', 'iroh-sw.js', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'])
for (const f of [...generated].filter((f) => f !== 'app' && f !== 'sw.js')) fs.copyFileSync(path.join(dist, f), path.join(out, f))

// Static directories on top, refusing anything that would overwrite the files above or each other.
const taken = new Set(generated)
for (const dir of ['landing', 'site']) {
  const src = path.join(root, dir)
  if (!fs.existsSync(src)) continue
  for (const entry of fs.readdirSync(src)) {
    if (entry === 'README.md' || entry === '.DS_Store') continue
    if (taken.has(entry)) throw new Error(`${dir}/${entry} collides with another file at the site root`)
    taken.add(entry)
    fs.cpSync(path.join(src, entry), path.join(out, entry), { recursive: true })
  }
}
fs.writeFileSync(path.join(out, '.nojekyll'), '')
console.log(`Pages site ready in ${path.relative(root, out)}/ (${[...taken].sort().join(', ')})`)
