// Where a link goes (desktop app, NACHTRAG external links). The Tauri webview shows only the bundled
// UI; everything else opens in the system's default app. desktop-app/src-tauri/src/external.rs
// applies the same rules on the Rust side (navigation, new-window requests, open_external).
//
//   internal → stays in the app (the bundled UI's own origin, in-page anchors)
//   external → http(s) and mailto: open in the default browser / mail app
//   blocked  → everything else (javascript:, file:, data:, custom schemes): nothing happens

export type LinkKind = 'internal' | 'external' | 'blocked'

/** Origins of the bundled UI inside the desktop shell (macOS/Linux and Windows). */
const APP_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'])

// URL.origin is "null" for non-special schemes such as tauri:, so compare scheme + host directly.
const originOf = (u: URL) => `${u.protocol}//${u.host}`

export function classifyLink(href: string, appOrigin: string): LinkKind {
  let url: URL
  try { url = new URL(href, appOrigin) } catch { return 'blocked' }
  if (url.protocol === 'mailto:') return 'external'
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tauri:') {
    const origin = originOf(url)
    if (origin === appOrigin || APP_ORIGINS.has(origin)) return 'internal'
    return url.protocol === 'tauri:' ? 'blocked' : 'external'
  }
  return 'blocked'
}
