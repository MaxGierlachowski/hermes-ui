import { useEffect, useRef, useState } from 'react'
import { Download, ImageOff, Play, VideoOff, X } from 'lucide-react'
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTouchUI } from '@/hooks/use-touch'
import { IROH_ORIGIN, apiUrl, linkUrl, loadObjectUrl, mediaNeedsBlob } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

/** Local paths and file:// URLs (as agents write them into Markdown) → the backend's read-only image route. */
export function resolveImageSrc(src: string) {
  if (src.startsWith('file:') || (src.startsWith('/') && !src.startsWith('/api/') && !src.startsWith('//'))) return `/api/file?path=${encodeURIComponent(src)}`
  return src
}

/** URL usable in <img>/<audio>/<video>: direct locally, via the iroh service worker or a blob URL remotely. */
export function useMediaUrl(url: string) {
  const full = apiUrl(resolveImageSrc(url))
  const viaBlob = () => mediaNeedsBlob() && full.startsWith(IROH_ORIGIN)
  const [src, setSrc] = useState<string | null>(viaBlob() ? '' : full)
  useEffect(() => {
    if (!viaBlob()) { setSrc(full); return }
    let revoke = ''
    setSrc('')
    loadObjectUrl(full).then((u) => { revoke = u; setSrc(u) }).catch(() => setSrc(null))
    return () => { if (revoke.startsWith('blob:')) URL.revokeObjectURL(revoke) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])
  return src // '' = loading, null = failed
}

/**
 * Image from a transcript: scales to the thread width, opens in a lightbox on click and shows a quiet
 * placeholder instead of a broken-image icon when the file is gone or not allowed.
 */
export function MediaImage({ url, alt = '', className }: { url: string; alt?: string; className?: string }) {
  const src = useMediaUrl(url)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const touch = useTouchUI()
  useEffect(() => setFailed(false), [src])
  if (src === null || failed) {
    return (
      <span className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1 align-middle text-xs text-muted-foreground" title={url}>
        <ImageOff className="size-3.5 shrink-0" /><span className="truncate">{alt || t('Bild nicht verfügbar')}</span>
      </span>
    )
  }
  if (!src) return <span className={cn('inline-block h-24 w-36 animate-pulse rounded-lg bg-muted align-middle', className)} />
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-block max-w-full cursor-zoom-in rounded-lg align-top outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('Bild vergrößern')}>
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn('block h-auto max-w-full rounded-lg ring-1 ring-border', className)} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {touch ? (
          <DialogContent
            showCloseButton={false}
            className="inset-0 top-0 left-0 block h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none bg-transparent p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
          >
            <DialogTitle className="sr-only">{alt || t('Bild')}</DialogTitle>
            <TouchViewer src={src} alt={alt} onClose={() => setOpen(false)} />
          </DialogContent>
        ) : (
        <DialogContent className="grid max-h-[94dvh] w-auto max-w-[96vw] place-items-center border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[94vw] max-md:[&>[data-slot=dialog-close]]:fixed max-md:[&>[data-slot=dialog-close]]:top-[max(0.5rem,env(safe-area-inset-top))] max-md:[&>[data-slot=dialog-close]]:right-2 max-md:[&>[data-slot=dialog-close]]:rounded-full max-md:[&>[data-slot=dialog-close]]:bg-black/55 max-md:[&>[data-slot=dialog-close]]:text-white">
          <DialogTitle className="sr-only">{alt || t('Bild')}</DialogTitle>
          <img src={src} alt={alt} className="max-h-[90dvh] max-w-[94vw] rounded-lg object-contain" onClick={() => setOpen(false)} />
        </DialogContent>
        )}
      </Dialog>
    </>
  )
}

/**
 * Touch lightbox: full screen on black. Pinch and double-tap zoom only the image (up to 6×), pan while
 * zoomed, swipe down to close while not zoomed. The page itself never zooms: the viewer takes every
 * touch (touch-action: none) and cancels iOS Safari's gesture* events, which drive page pinch-zoom there.
 */
function TouchViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false)
  const [dy, setDy] = useState(0)
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)
  const zoom = useRef<ReactZoomPanPinchRef | null>(null)
  // Double tap: touch browsers send no dblclick here (touch-action: none), so taps are matched by hand.
  const tap = useRef<{ x: number; y: number; t: number; moved: boolean; multi: boolean } | null>(null)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault()
    const names = ['gesturestart', 'gesturechange', 'gestureend']
    names.forEach((n) => document.addEventListener(n, stop, { passive: false }))
    return () => names.forEach((n) => document.removeEventListener(n, stop))
  }, [])
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0]
    tap.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY, t: performance.now(), moved: false, multi: false } : tap.current && { ...tap.current, multi: true }
    swipe.current = !zoomed && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const tp = tap.current
    if (tp && Math.hypot(e.touches[0].clientX - tp.x, e.touches[0].clientY - tp.y) > 10) tp.moved = true
    const s = swipe.current
    if (!s) return
    if (e.touches.length > 1) { swipe.current = null; setDy(0); return }
    const d = e.touches[0].clientY - s.y
    // Only a mainly vertical, downward drag closes; sideways or upwards does nothing.
    setDy(d > 0 && Math.abs(d) > Math.abs(e.touches[0].clientX - s.x) ? d : 0)
  }
  const onDoubleTap = (x: number, y: number) => {
    const z = zoom.current
    if (!z) return
    // Zoomed, the tap also ended a (zero-length) pan whose inertia animation would cancel the reset: run it after.
    if (zoomed) { setTimeout(() => z.resetTransform(200), 30); return }
    const k = 2.5 // keep the tapped point under the finger
    z.setTransform(x - x * k, y - y * k, k, 200)
  }
  const onTouchEnd = () => {
    const tp = tap.current
    tap.current = null
    if (tp && !tp.moved && !tp.multi && performance.now() - tp.t < 300) {
      const last = lastTap.current
      if (last && tp.t - last.t < 320 && Math.hypot(tp.x - last.x, tp.y - last.y) < 40) { lastTap.current = null; onDoubleTap(tp.x, tp.y) }
      else lastTap.current = { x: tp.x, y: tp.y, t: tp.t }
    }
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const fast = dy > 24 && dy / Math.max(1, performance.now() - s.t) > 0.6
    if (dy > 110 || fast) onClose()
    else setDy(0)
  }
  return (
    <div
      className="fixed inset-0 touch-none select-none overscroll-none"
      style={{ backgroundColor: `rgb(0 0 0 / ${1 - Math.min(dy / 500, 0.6)})` }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      data-testid="image-viewer"
    >
      <div className={cn('size-full', !dy && 'transition-transform duration-200 ease-out')} style={{ transform: dy ? `translateY(${dy}px) scale(${1 - Math.min(dy / 2000, 0.15)})` : undefined }}>
        <TransformWrapper
          onInit={(r) => { zoom.current = r }}
          minScale={1}
          maxScale={6}
          doubleClick={{ disabled: true }}
          panning={{ disabled: !zoomed, velocityDisabled: false }}
          wheel={{ disabled: true }}
          onTransform={(_, st) => { const z = st.scale > 1.01; setZoomed((p) => (p === z ? p : z)) }}
        >
          <TransformComponent wrapperClass="!size-full" contentClass="!size-full">
            <img src={src} alt={alt} draggable={false} className="size-full object-contain" data-testid="image-viewer-img" />
          </TransformComponent>
        </TransformWrapper>
      </div>
      <DialogClose asChild>
        <button
          type="button"
          aria-label={t('Schließen')}
          className="fixed right-2 top-[max(0.5rem,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-black/55 text-white active:bg-black/70"
        >
          <X className="size-5" />
        </button>
      </DialogClose>
    </div>
  )
}

export function MediaAudio({ url, className }: { url: string; className?: string }) {
  const src = useMediaUrl(url)
  return <audio controls src={src || undefined} className={className} />
}

/**
 * Video attached to a reply: the native player (the backend answers Range requests, which Safari/iOS
 * need to play at all and every browser needs to seek) plus a download link. Over iroh without a
 * service worker the whole file would become a blob, so it only loads on request there.
 */
export function MediaVideo({ url, name }: { url: string; name: string }) {
  const full = apiUrl(url)
  const [wanted, setWanted] = useState(() => !(mediaNeedsBlob() && full.startsWith(IROH_ORIGIN)))
  if (!wanted) {
    return (
      <button type="button" onClick={() => setWanted(true)} className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <Play className="size-4 shrink-0" /><span className="truncate">{t('Video laden')} · {name}</span>
      </button>
    )
  }
  return <VideoPlayer url={url} name={name} />
}

function VideoPlayer({ url, name }: { url: string; name: string }) {
  const src = useMediaUrl(url)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = !!src && failedSrc === src
  const href = src?.startsWith('blob:') ? src : linkUrl(apiUrl(url))
  return (
    <div className="flex w-full max-w-xl flex-col items-start gap-1">
      {src === null || failed ? (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground" title={name}>
          <VideoOff className="size-3.5 shrink-0" /><span className="truncate">{t('Video nicht verfügbar')}</span>
        </span>
      ) : !src ? (
        <span className="block aspect-video w-full animate-pulse rounded-lg bg-muted" />
      ) : (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailedSrc(src)}
          className="block max-h-[min(28rem,70dvh)] w-full rounded-lg bg-black object-contain ring-1 ring-border"
          data-testid="media-video"
        />
      )}
      {href && (
        <a href={href} download={name} className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title={t('Herunterladen')}>
          <Download className="size-3.5 shrink-0" /><span className="truncate">{name}</span>
        </a>
      )}
    </div>
  )
}
