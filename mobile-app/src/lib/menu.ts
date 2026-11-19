// Context and dropdown menus for the wide layout. In the desktop app they are real macOS menus (Tauri),
// in a browser a small popover drawn by <MenuHost/>. Same items either way.
import { useSyncExternalStore } from 'react'
import { nativeMenu } from './desktop'

export type MenuItem = { id: string; text: string; enabled?: boolean; checked?: boolean; destructive?: boolean } | '-'
export type MenuState = { items: MenuItem[]; at: { x: number; y: number; align?: 'left' | 'right' }; onPick: (id: string) => void } | null

let menu: MenuState = null
const listeners = new Set<() => void>()
const set = (m: MenuState) => { menu = m; listeners.forEach((l) => l()) }
export const closeMenu = () => set(null)
export function useMenu() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => menu)
}

/** Opens a menu at a window position (the pointer for a right click, below a button for a dropdown). */
export async function openMenu(items: MenuItem[], at: { x: number; y: number; align?: 'left' | 'right' }, onPick: (id: string) => void) {
  const native = await nativeMenu(items.map((i) => (i === '-' ? i : { id: i.id, text: i.text, enabled: i.enabled, checked: i.checked })), onPick)
  if (!native) set({ items, at, onPick })
}
