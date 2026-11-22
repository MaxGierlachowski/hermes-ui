import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The service worker that routes <img>/<audio> of backend URLs over iroh ships with iroh-fetch;
// it must be served from the UI's own origin, next to index.html.
const irohServiceWorker = (): Plugin => ({
  name: 'iroh-sw',
  buildStart() {
    fs.copyFileSync(path.resolve(__dirname, 'node_modules/iroh-fetch/src/sw.js'), path.resolve(__dirname, 'public/iroh-sw.js'))
  },
})

// Every build gets an id: compiled into the bundle and written to version.json, which the backend
// announces on its event stream, so open clients notice that a newer UI is being served.
const BUILD = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const buildVersion = (): Plugin => ({
  name: 'build-version',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD })}\n` }) },
})

// base './': the built UI works from any path (backend root, GitHub Pages sub-path, any static host).
// Dev: `npm run dev` proxies /api to a running backend (default 127.0.0.1:8787).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), irohServiceWorker(), buildVersion()],
  define: { __HERMES_UI_BUILD__: JSON.stringify(BUILD) },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  optimizeDeps: { exclude: ['iroh-fetch'] },
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.HERMES_UI_PORT || 8787}` } } },
})
