// Copies iroh-fetch (ES modules + WASM) to public/vendor/iroh-fetch for the web and desktop build.
// The app loads it at runtime as a native ES module (transport.web.ts): Metro cannot bundle its
// `new URL('…wasm', import.meta.url)`. Run by `npm run web` / `npm run web:export`.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// The package exports no ./package.json: find its directory from the main entry.
let pkg = path.dirname(require.resolve('iroh-fetch'))
while (!fs.existsSync(path.join(pkg, 'package.json'))) pkg = path.dirname(pkg)
const out = path.resolve(import.meta.dirname, '..', 'public', 'vendor', 'iroh-fetch')
fs.rmSync(out, { recursive: true, force: true })
for (const dir of ['src', 'wasm']) fs.cpSync(path.join(pkg, dir), path.join(out, dir), { recursive: true, filter: (f) => !f.endsWith('.d.ts') && !/node\.js$|native\.js$/.test(f) })
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(out, 'LICENSE'))
// A static module that exposes iroh-fetch to the (classic-script) app bundle: no inline script and no
// eval, so it works under the desktop app's Content-Security-Policy.
fs.writeFileSync(path.join(out, '..', 'iroh-loader.mjs'), `import * as m from './iroh-fetch/src/browser.js'\nwindow.__irohFetch = m\nwindow.dispatchEvent(new Event('iroh-fetch-ready'))\n`)
console.log(`iroh-fetch ${JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version} → ${path.relative(process.cwd(), out)}`)
