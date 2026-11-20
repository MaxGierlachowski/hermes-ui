// Web / desktop: blob:, data: or http: URLs (image picker, MediaRecorder, paste/drop) as an upload.
// The browser's recording is WebM/Opus, not the phone's M4A: the type comes from the blob.
import type { Upload } from '@shared/types'

export const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

export async function fileUpload(uri: string, type: string, name?: string): Promise<Upload> {
  const blob = await (await fetch(uri)).blob()
  const real = blob.type || type
  const ext = real.split('/')[1]?.split(';')[0]
  return { name: name && ext && real !== type ? name.replace(/\.\w+$/, `.${ext === 'mpeg' ? 'mp3' : ext}`) : name, type: real, data: await blobToBase64(blob) }
}
