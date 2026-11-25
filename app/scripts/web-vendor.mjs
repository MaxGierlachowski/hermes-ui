// Copies iroh-fetch (ES modules + WASM) to public/vendor/iroh-fetch, pdf.js to public/vendor/pdfjs and the Geist font (the web UI's
// typeface, latin + latin-ext) to public/vendor/fonts for the web and desktop build.
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

// Geist (OFL-1.1), loaded by PlatformShell.web.tsx. Native builds keep the system font.
const geist = path.dirname(require.resolve('@fontsource-variable/geist/index.css'))
const fonts = path.join(out, '..', 'fonts')
fs.mkdirSync(fonts, { recursive: true })
for (const f of ['geist-latin-wght-normal.woff2', 'geist-latin-ext-wght-normal.woff2']) fs.copyFileSync(path.join(geist, 'files', f), path.join(fonts, f))
fs.copyFileSync(path.join(geist, 'LICENSE'), path.join(fonts, 'LICENSE'))

// pdf.js (Apache-2.0): the PDF preview on the web and in the desktop app (components/files/pdf.web.tsx).
// The legacy build: the desktop app's WebView goes back to macOS 13. Loaded like iroh-fetch, as a native
// ES module (lib/pdf.web.ts); the worker, fonts, CMaps and WASM decoders come from the same folder, no CDN.
const pdfjs = path.dirname(require.resolve('pdfjs-dist/package.json'))
const pdfOut = path.join(out, '..', 'pdfjs')
fs.rmSync(pdfOut, { recursive: true, force: true })
fs.mkdirSync(pdfOut, { recursive: true })
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) fs.copyFileSync(path.join(pdfjs, 'legacy', 'build', f), path.join(pdfOut, f))
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) fs.cpSync(path.join(pdfjs, dir), path.join(pdfOut, dir), { recursive: true })
fs.copyFileSync(path.join(pdfjs, 'LICENSE'), path.join(pdfOut, 'LICENSE'))
fs.writeFileSync(path.join(out, '..', 'pdfjs-loader.mjs'), `import * as m from './pdfjs/pdf.min.mjs'\nm.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', import.meta.url).href\nwindow.__pdfjs = m\nwindow.dispatchEvent(new Event('pdfjs-ready'))\n`)
console.log(`pdf.js ${JSON.parse(fs.readFileSync(path.join(pdfjs, 'package.json'), 'utf8')).version} → ${path.relative(process.cwd(), pdfOut)}`)
