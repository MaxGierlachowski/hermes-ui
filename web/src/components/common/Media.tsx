import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { IROH_ORIGIN, apiUrl, loadObjectUrl, mediaNeedsBlob } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

/** Local paths and file:// URLs (as agents write them into Markdown) → the backend's read-only image route. */
export function resolveImageSrc(src: string) {
  if (src.startsWith('file:') || (src.startsWith('/') && !src.startsWith('/api/') && !src.startsWith('//'))) return `/api/file?path=${encodeURIComponent(src)}`
  return src
}

/** URL usable in <img>/<audio>: direct locally, via the iroh service worker or a blob URL remotely. */
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
        <DialogContent className="grid max-h-[94dvh] w-auto max-w-[96vw] place-items-center border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[94vw] max-md:[&>[data-slot=dialog-close]]:fixed max-md:[&>[data-slot=dialog-close]]:top-[max(0.5rem,env(safe-area-inset-top))] max-md:[&>[data-slot=dialog-close]]:right-2 max-md:[&>[data-slot=dialog-close]]:rounded-full max-md:[&>[data-slot=dialog-close]]:bg-black/55 max-md:[&>[data-slot=dialog-close]]:text-white">
          <DialogTitle className="sr-only">{alt || t('Bild')}</DialogTitle>
          <img src={src} alt={alt} className="max-h-[90dvh] max-w-[94vw] rounded-lg object-contain" onClick={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function MediaAudio({ url, className }: { url: string; className?: string }) {
  const src = useMediaUrl(url)
  return <audio controls src={src || undefined} className={className} />
}
