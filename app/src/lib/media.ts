// Native media: backend URLs (/api/media/…, /api/file?…) as local files for <Image>/players,
// downloaded over the connection once and kept in the cache directory. Web: media.web.ts.
import { Directory, File, Paths } from 'expo-file-system'
import { ApiError, getBackend, NotConnected } from './connection'

const mediaDir = () => {
  const dir = new Directory(Paths.cache, 'media')
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}
const inflight = new Map<string, Promise<string>>()
const MEDIA_MAX_BYTES = 200 * 1024 * 1024

/** Keeps the media cache under MEDIA_MAX_BYTES, oldest files first (the OS may also clear it). */
export function pruneMedia() {
  try {
    const files = mediaDir().list().filter((f): f is File => f instanceof File)
      .map((f) => ({ f, size: f.size ?? 0, t: f.modificationTime ?? 0 }))
      .sort((a, b) => b.t - a.t)
    let total = 0
    for (const { f, size } of files) {
      total += size
      if (total > MEDIA_MAX_BYTES) { try { f.delete() } catch { /* in use or gone */ } }
    }
  } catch { /* nothing cached yet */ }
}

export function clearMedia() {
  try { new Directory(Paths.cache, 'media').delete() } catch { /* nothing cached */ }
}

const hash = (s: string) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

const mediaPath = (url: string) => {
  // Files from chats (/api/sessions/…/file?path=…) keep their extension: viewers go by it.
  const named = new URLSearchParams(url.split('?')[1] || '').get('path')?.match(/\.(\w{1,8})$/)?.[1]
  const ext = (url.split('?')[0].match(/\.(\w{2,5})$/)?.[1] || named || decodeURIComponent(url).match(/\.(png|jpe?g|gif|webp|heic|m4a|mp3|ogg|opus|wav|webm|mp4)\b/i)?.[1] || 'bin').toLowerCase()
  return new File(mediaDir(), `${hash(url)}.${ext}`)
}

/** Already on disk? Then a screen can render the image in its first frame instead of a spinner. */
export function cachedMediaFile(url: string): string | null {
  if (!url.startsWith('/api/')) return url
  try { const file = mediaPath(url); return file.exists ? file.uri : null } catch { return null }
}

/** file:// URI of a backend media URL, downloaded once and cached. */
export function mediaFile(url: string): Promise<string> {
  if (!url.startsWith('/api/')) return Promise.resolve(url)
  const file = mediaPath(url)
  if (file.exists) return Promise.resolve(file.uri)
  let p = inflight.get(url)
  if (!p) {
    p = (async () => {
      const backend = getBackend()
      if (!backend?.download) throw new NotConnected('not connected')
      const r = await backend.download(url, file.uri)
      if (r.status < 200 || r.status >= 300) throw new ApiError(`HTTP ${r.status}`, r.status)
      return file.uri
    })().finally(() => inflight.delete(url))
    inflight.set(url, p)
  }
  return p
}
