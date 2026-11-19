// Pure helpers of the image viewer (components/Lightbox.tsx); tested in server/test/lightbox.test.mjs.

/** The largest size with the image's aspect ratio that fits the box, never larger than the image itself (zoom is for that). */
export function fitImage(img: { width: number; height: number } | null, box: { width: number; height: number }) {
  if (!img || !img.width || !img.height) return box
  const k = Math.min(box.width / img.width, box.height / img.height, 1)
  return { width: Math.round(img.width * k), height: Math.round(img.height * k) }
}

/** What the error state shows: the file path of a backend media URL, never its (tokenised) query. */
export function imageLabel(url: string) {
  if (url.startsWith('data:')) return `${url.slice(0, 32)}…`
  if (url.startsWith('blob:')) return url
  try {
    const u = new URL(url, 'http://local')
    const path = u.searchParams.get('path')
    return path || (url.startsWith('/') ? u.pathname : `${u.origin === 'http://local' ? '' : u.origin}${u.pathname}`)
  } catch { return url.split('?')[0] }
}
