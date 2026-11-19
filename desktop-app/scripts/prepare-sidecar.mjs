// Prepares the backend sidecar for `tauri build` / `tauri dev`:
//   1. bundles the backend (server/, ESM + its npm dependencies) into one file with esbuild,
//      src-tauri/resources/server/hermes-ui.mjs (a Tauri resource),
//   2. copies the Node.js binary running this script to src-tauri/binaries/node-<target triple>
//      (a Tauri "externalBin" sidecar), so the app runs the backend without a Node install.
// The Node version is the repo's pin (.nvmrc). Both outputs are git-ignored build artefacts.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as esbuild from 'esbuild'

const here = path.dirname(new URL(import.meta.url).pathname)
const tauri = path.resolve(here, '..', 'src-tauri')
const repo = path.resolve(here, '..', '..')

const out = path.join(tauri, 'resources', 'server', 'hermes-ui.mjs')
await esbuild.build({
  entryPoints: [path.join(repo, 'server', 'bin', 'hermes-ui.mjs')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Optional native speed-ups of `ws`; it falls back to plain JS without them.
  external: ['bufferutil', 'utf-8-validate'],
  // CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  minify: true,
  legalComments: 'linked',
  logLevel: 'warning',
})
console.log(`backend → ${path.relative(repo, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)

const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/host: (\S+)/)[1]
const bin = path.join(tauri, 'binaries', `node-${triple}`)
fs.mkdirSync(path.dirname(bin), { recursive: true })
fs.copyFileSync(process.execPath, bin)
fs.chmodSync(bin, 0o755)
console.log(`node ${process.version} → ${path.relative(repo, bin)} (${(fs.statSync(bin).size / 1048576).toFixed(0)} MB)`)
