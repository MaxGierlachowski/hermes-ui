// Web / desktop media: the browser loads backend media itself and keeps it in its HTTP cache. The
// connection turns a backend path into something an <img>/<audio> can load (tokenised URL on the
// local HTTP transport, object URL over iroh, data URL in the demo). Native: media.ts.
import { getBackend, NotConnected } from './connection'

const urls = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

export function cachedMediaFile(url: string): string | null {
  if (!url.startsWith('/api/')) return url
  return urls.get(url) ?? null
}

export function mediaFile(url: string): Promise<string> {
  if (!url.startsWith('/api/')) return Promise.resolve(url)
  const known = urls.get(url)
  if (known) return Promise.resolve(known)
  let p = inflight.get(url)
  if (!p) {
    p = (async () => {
      const b = getBackend()
      if (!b?.mediaUrl) throw new NotConnected('not connected')
      const u = await b.mediaUrl(url)
      urls.set(url, u)
      return u
    })().finally(() => inflight.delete(url))
    inflight.set(url, p)
  }
  return p
}

export const pruneMedia = () => {}
export function clearMedia() {
  for (const u of urls.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u)
  urls.clear()
}
