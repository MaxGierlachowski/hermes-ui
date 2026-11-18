import { useEffect, useState } from 'react'
import { apiUrl, loadObjectUrl, mediaNeedsBlob } from '@/lib/backend'

/** <img>/<audio> for backend URLs: direct locally, via the iroh service worker or a blob URL remotely. */
export function useMediaUrl(url: string) {
  const full = apiUrl(url)
  const [src, setSrc] = useState(mediaNeedsBlob() && full.startsWith('http') ? '' : full)
  useEffect(() => {
    if (!mediaNeedsBlob() || !full.startsWith('http')) { setSrc(full); return }
    let revoke = ''
    loadObjectUrl(full).then((u) => { revoke = u; setSrc(u) }).catch(() => setSrc(''))
    return () => { if (revoke.startsWith('blob:')) URL.revokeObjectURL(revoke) }
  }, [full])
  return src
}

export function MediaImage({ url, className }: { url: string; className?: string }) {
  const src = useMediaUrl(url)
  return src ? <img src={src} alt="" className={className} /> : <div className={`${className} animate-pulse bg-muted`} style={{ width: 96, height: 64 }} />
}

export function MediaAudio({ url, className }: { url: string; className?: string }) {
  const src = useMediaUrl(url)
  return <audio controls src={src || undefined} className={className} />
}
