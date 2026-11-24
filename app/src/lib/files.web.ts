// Files from chats on the web and in the desktop app (native: files.ts). Preview URLs come from the
// connection like every media URL (tokenised HTTP URL, iroh object URL, demo data URL).
//
//   download: desktop app → the bytes into the Downloads folder (Rust `save_download`, never
//             overwrites), confirmed with a toast; browser → an <a download> click (the backend answers with
//             Content-Disposition: attachment anyway).
//   open in system: desktop app with a backend on this machine only (the path is a path here).
import type { FileInfo } from '@shared/types'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getBackend, mediaFile } from './connection'
import { isDesktop } from './desktop.web'
import { toast } from './store'
import { t } from './i18n'

export const downloadUrl = (f: FileInfo) => `${f.url}&download=1`

/** Something an <img>/<video>/<iframe> can load. PDFs become a blob URL (an iframe needs the same origin rules everywhere). */
export async function previewSource(f: FileInfo, kind: string): Promise<string> {
  const u = await mediaFile(f.url)
  if (kind !== 'pdf' || u.startsWith('blob:')) return u
  const blob = await (await fetch(u)).blob()
  return URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
}

export async function downloadFile(f: FileInfo): Promise<void> {
  const u = await mediaFile(downloadUrl(f))
  if (isDesktop) {
    const res = await fetch(u)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const saved = await tauriInvoke<string>('save_download', bytes, { headers: { 'x-file-name': encodeURIComponent(f.name) } })
    toast(t('In Downloads gespeichert'), 'success', null, saved.split('/').pop() || f.name)
    return
  }
  const a = document.createElement('a')
  a.href = u
  a.download = f.name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** "Open in system": only in the desktop app, and only when the backend runs on this machine. */
export const canOpenInSystem = () => isDesktop && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(getBackend()?.gateway.endpointId || '')

export async function openInSystem(f: FileInfo): Promise<boolean> {
  if (!canOpenInSystem()) return false
  try { await tauriInvoke('open_local_file', { path: f.path }); return true } catch (e) { toast(String(e), 'error'); return false }
}
