// Serves the web export (dist-web) for the UI tests: static files, index.html for every route.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', 'dist-web')
const port = Number(process.argv[2]) || 4180
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.png': 'image/png', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream', '.bcmap': 'application/octet-stream', '.icc': 'application/vnd.iccprofile' }

http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = p.startsWith(root) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(root, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1')
