// pdf.js for the PDF preview on the web and in the desktop app (components/files/pdf.web.tsx).
// Loaded like iroh-fetch (transport.web.ts): a native ES module from /vendor (copied there at build
// time, scripts/web-vendor.mjs), through a <script type="module"> tag, so no eval and no CDN, fine
// under the desktop app's CSP. The worker, fonts, CMaps and WASM decoders come from the same folder.
//
// Why not the browser's own viewer in an <iframe>: the desktop app's navigation guard cancels the
// iframe's blob: navigation (WKWebView asks the same policy for subframes), Android's WebView and
// Chrome on Android have no PDF viewer, and iOS Safari shows only the first page.
import type * as PdfJs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

export type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

let pdfjs: Promise<typeof PdfJs> | null = null
const loadPdfjs = () => (pdfjs ??= new Promise((resolve, reject) => {
  const w = window as unknown as { __pdfjs?: typeof PdfJs }
  if (w.__pdfjs) return resolve(w.__pdfjs)
  window.addEventListener('pdfjs-ready', () => resolve(w.__pdfjs!), { once: true })
  const s = document.createElement('script')
  s.type = 'module'
  s.src = vendor('pdfjs-loader.mjs')
  s.onerror = () => { pdfjs = null; reject(new Error('pdf.js could not be loaded')) }
  document.head.appendChild(s)
}))

const vendor = (p: string) => new URL(`vendor/${p}`, document.baseURI).href

/** Opens a PDF from anything fetch() can read (tokenised URL, blob: or data: URL). `.destroy()` ends it. */
export async function openPdf(uri: string): Promise<PDFDocumentLoadingTask> {
  const [lib, data] = await Promise.all([
    loadPdfjs(),
    fetch(uri).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer() }),
  ])
  return lib.getDocument({
    data: new Uint8Array(data),
    cMapUrl: vendor('pdfjs/cmaps/'),
    standardFontDataUrl: vendor('pdfjs/standard_fonts/'),
    wasmUrl: vendor('pdfjs/wasm/'),
    iccUrl: vendor('pdfjs/iccs/'),
  })
}

/** pdf.js cancelled a render on purpose (page scrolled away, new width): not an error. */
export const isCancelled = (e: unknown) => (e as { name?: string })?.name === 'RenderingCancelledException'
