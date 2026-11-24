// The PDF preview on the web and in the desktop app, drawn with pdf.js (lib/pdf.web.ts): one canvas
// per page, fitted to the width, at the screen's pixel density. Long PDFs stay light: only pages near
// the visible area have a canvas (IntersectionObserver), the others are empty boxes of the right size.
// White paper on the muted backdrop in light and dark mode; "page n / N" at the bottom.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator } from 'react-native'
import { isCancelled, openPdf, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from '@/lib/pdf.web'
import { t } from '@/lib/i18n'

const GAP = 16
const MAX_PAGE_WIDTH = 1000
// Browsers refuse (iOS: blank) canvases above ~16 megapixels; stay well below.
const MAX_CANVAS_PIXELS = 12_000_000
// Pages within this distance of the visible area get a canvas; further away, it is dropped again.
const NEAR = '150% 0px'

type Size = { w: number; h: number } // PDF points at scale 1

function PdfPage({ doc, n, width, size, near, onSize, onError }: {
  doc: PDFDocumentProxy; n: number; width: number; size: Size; near: boolean
  onSize: (n: number, s: Size) => void; onError: (e: unknown) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const height = Math.round((width * size.h) / size.w)
  useEffect(() => {
    if (!near || !width) return
    let task: RenderTask | null = null
    let alive = true
    doc.getPage(n).then((page) => {
      const base = page.getViewport({ scale: 1 })
      if (!alive) return
      if (base.width !== size.w || base.height !== size.h) onSize(n, { w: base.width, h: base.height })
      const css = width / base.width
      const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * css * base.height * css)))
      const viewport = page.getViewport({ scale: css * dpr })
      const c = canvas.current
      if (!c) return
      c.width = Math.floor(viewport.width)
      c.height = Math.floor(viewport.height)
      task = page.render({ canvas: c, viewport, background: '#fff' })
      return task.promise
    }).catch((e) => { if (alive && !isCancelled(e)) onError(e) })
    return () => { alive = false; task?.cancel() }
  }, [doc, n, width, near])
  return (
    <div data-page={n} style={{ width, height, flex: 'none', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04)', borderRadius: 2, overflow: 'hidden' }}>
      {near && <canvas ref={canvas} aria-hidden style={{ display: 'block', width: '100%', height: '100%' }} />}
    </div>
  )
}

export function PdfPages({ uri, title, onError }: { uri: string; title: string; onError: (e: unknown) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<Size[]>([])
  const [width, setWidth] = useState(0)
  const [near, setNear] = useState<Set<number>>(() => new Set([1]))
  const [current, setCurrent] = useState(1)

  useEffect(() => {
    let alive = true
    let task: PDFDocumentLoadingTask | null = null
    openPdf(uri)
      .then((t) => { task = t; if (!alive) t.destroy(); return t.promise })
      .then(async (d) => {
        // Until a page is rendered, every page takes the first page's size.
        const first = (await d.getPage(1)).getViewport({ scale: 1 })
        if (!alive) return
        setSizes(Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height })))
        setDoc(d)
      })
      .catch((e) => alive && onError(e))
    return () => { alive = false; task?.destroy() }
  }, [uri])

  // Width-fit, follows the window.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const fit = () => setWidth(Math.max(0, Math.min(MAX_PAGE_WIDTH, el.clientWidth - 2 * GAP)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Which pages are near the visible area.
  useEffect(() => {
    const el = scroller.current
    if (!el || !doc) return
    const io = new IntersectionObserver((entries) => setNear((prev) => {
      const next = new Set(prev)
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset.page)
        if (e.isIntersecting) next.add(n); else next.delete(n)
      }
      return next
    }), { root: el, rootMargin: NEAR })
    el.querySelectorAll('[data-page]').forEach((p) => io.observe(p))
    return () => io.disconnect()
  }, [doc, width > 0])

  // Page counter: the page in the middle of the view.
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const mid = el.scrollTop + el.clientHeight / 2
    let n = 1
    for (const p of el.querySelectorAll<HTMLElement>('[data-page]')) { if (p.offsetTop <= mid) n = Number(p.dataset.page); else break }
    setCurrent(n)
  }

  const onSize = (n: number, s: Size) => setSizes((prev) => prev.map((x, i) => (i === n - 1 ? s : x)))
  const total = doc?.numPages ?? 0
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', background: 'hsl(var(--muted))' }}>
      <div ref={scroller} onScroll={onScroll} role="document" aria-label={title} data-testid="pdf-pages"
        style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: GAP, padding: GAP, paddingBottom: GAP * 3 }}>
        {doc && width > 0 && sizes.map((s, i) => (
          <PdfPage key={i} doc={doc} n={i + 1} width={width} size={s} near={near.has(i + 1)} onSize={onSize} onError={onError} />
        ))}
      </div>
      {!doc && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></div>}
      {total > 0 && (
        <div aria-label={t('Seite {n} von {total}', { n: current, total })} aria-live="polite"
          style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', padding: '3px 10px', borderRadius: 999, background: 'rgba(24,24,27,.78)', color: '#fff', font: '500 12px/18px system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>
          {current} / {total}
        </div>
      )}
    </div>
  )
}
