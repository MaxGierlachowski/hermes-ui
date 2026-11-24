// Viewers on the web and in the desktop app (native: viewers.tsx). PDFs are drawn with pdf.js
// (PdfPages.web.tsx), not the browser's own viewer: that one is missing (Android) or blocked in a frame
// (desktop app), and it would follow the page's colours nowhere.
import { createElement } from 'react'
export { PdfPages as PdfView } from './PdfPages.web'

export const canShowPdf = true
export const canShowVideo = true

export function VideoView({ uri }: { uri: string }) {
  return createElement('video', { src: uri, controls: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'contain', background: '#000' } })
}
