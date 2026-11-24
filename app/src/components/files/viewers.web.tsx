// Viewers the browser has built in (native: viewers.tsx). The PDF arrives as a blob URL
// (lib/files.web.ts previewSource), so the iframe never loads a backend URL with a token in it.
import { createElement } from 'react'

export const canShowPdf = true
export const canShowVideo = true

export function PdfView({ uri, title }: { uri: string; title: string }) {
  return createElement('div', { style: { position: 'relative', flex: 1 } },
    createElement('iframe', { src: uri, title, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#fff' } }))
}

export function VideoView({ uri }: { uri: string }) {
  return createElement('video', { src: uri, controls: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'contain', background: '#000' } })
}
