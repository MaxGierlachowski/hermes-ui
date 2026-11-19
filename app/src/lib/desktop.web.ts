// Bridge to the Tauri desktop shell (desktop-app/). In a plain browser every function is a no-op or
// returns null, so the same web build runs in Chrome/Safari and inside the desktop app.
//
// The shell's Rust side offers (desktop-app/src-tauri/src/lib.rs):
//   local_backend      → { baseUrl, token, managed } of the backend it started (sidecar) or was told about
//   secret_get/set/delete → the macOS Keychain (Windows Credential Manager, Secret Service on Linux)
// and sends the events "menu" (native menu / tray item ids) and "deep-link".
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent)

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isDesktop) return null
  try { return await tauriInvoke<T>(cmd, args) } catch (e) { console.warn(`[hermes-ui] ${cmd}:`, e); return null }
}

export type LocalBackend = { baseUrl: string; token: string; managed: boolean }
export const localBackend = () => invoke<LocalBackend>('local_backend')

/** Native menu / tray / global-shortcut actions ("new-chat", "search", "column-1", …). */
export function onShellAction(fn: (id: string) => void): () => void {
  if (!isDesktop) return () => {}
  let off: (() => void) | null = null
  let dead = false
  listen<string>('menu', (e) => fn(e.payload)).then((u) => { if (dead) u(); else off = u })
  return () => { dead = true; off?.() }
}

/** Dock badge (macOS) with the inbox count. */
export async function setBadge(count: number) {
  if (!isDesktop) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined)
  } catch { /* not supported on this platform */ }
}

/** A native context menu at the pointer (Tauri), or null in the browser (the caller shows its own). */
export async function nativeMenu(items: ({ id: string; text: string; enabled?: boolean; checked?: boolean; items?: { id: string; text: string; checked?: boolean }[] } | '-')[], onPick: (id: string) => void): Promise<boolean> {
  if (!isDesktop) return false
  const { Menu, MenuItem, PredefinedMenuItem, Submenu, CheckMenuItem } = await import('@tauri-apps/api/menu')
  const build = await Promise.all(items.map(async (it) => {
    if (it === '-') return PredefinedMenuItem.new({ item: 'Separator' })
    if (it.items) {
      const sub = await Promise.all(it.items.map((s) => CheckMenuItem.new({ id: s.id, text: s.text, checked: !!s.checked, action: () => onPick(s.id) })))
      return Submenu.new({ text: it.text, items: sub })
    }
    if (it.checked !== undefined) return CheckMenuItem.new({ id: it.id, text: it.text, checked: it.checked, enabled: it.enabled !== false, action: () => onPick(it.id) })
    return MenuItem.new({ id: it.id, text: it.text, enabled: it.enabled !== false, action: () => onPick(it.id) })
  }))
  const menu = await Menu.new({ items: build })
  await menu.popup()
  return true
}

/** Any event the shell emits (e.g. "notification-click" with a session id). */
export function onShellEvent<T>(name: string, fn: (payload: T) => void): () => void {
  if (!isDesktop) return () => {}
  let off: (() => void) | null = null
  let dead = false
  listen<T>(name, (e) => fn(e.payload)).then((u) => { if (dead) u(); else off = u })
  return () => { dead = true; off?.() }
}
