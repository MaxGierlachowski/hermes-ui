// Where things open, by layout. On a phone (and a narrow window) a thread, the Paseo transcript, search
// and "new chat" are screens on the navigation stack. In the wide layout (desktop, large tablet) the
// thread and the transcript open in the split pane next to the board, search and "new chat" as
// overlays, so the board stays in view.
import { useSyncExternalStore } from 'react'
import { Dimensions } from 'react-native'
import { router } from 'expo-router'
import { openThread } from './store'

export type Layout = 'phone' | 'tablet' | 'desktop'
/** Breakpoints (window width in dp/px): tablet = two columns side by side, desktop = four + split. */
export const layoutFor = (width: number): Layout => (width >= 1024 ? 'desktop' : width >= 700 ? 'tablet' : 'phone')

export type Pane = { kind: 'thread' } | { kind: 'paseo'; agent?: string }
type Nav = { pane: Pane; overlay: 'search' | 'new' | null }

let nav: Nav = { pane: { kind: 'thread' }, overlay: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<Nav>) => { nav = { ...nav, ...patch }; listeners.forEach((l) => l()) }
export const getNav = () => nav
export function useNav<T>(select: (n: Nav) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => select(nav))
}

/** Wide layout right now (read at call time, so it also holds before the home screen rendered). */
export const isWide = () => layoutFor(Dimensions.get('window').width) === 'desktop'
export const setPane = (pane: Pane) => set({ pane })
export const setOverlay = (overlay: Nav['overlay']) => set({ overlay })

const threadHref = (id: string) => `/thread/${encodeURIComponent(id)}` as const

/** Opens a chat: in the split pane (wide) or as a screen (phone). `replace` swaps the current screen. */
export function showThread(id: string, opts: { replace?: boolean } = {}) {
  openThread(id)
  if (isWide()) {
    set({ pane: { kind: 'thread' }, overlay: null })
    if (router.canGoBack()) router.dismissTo('/')
    return
  }
  if (opts.replace) router.replace(threadHref(id))
  else router.push(threadHref(id))
}

/** The Paseo agents of a chat (and optionally one agent's transcript). */
export function showPaseo(sessionId: string, agent?: string) {
  if (isWide()) { openThread(sessionId); set({ pane: { kind: 'paseo', agent } }); return }
  router.push({ pathname: '/paseo/[id]', params: agent ? { id: sessionId, agent } : { id: sessionId } })
}

export function showSearch() {
  if (isWide()) set({ overlay: 'search' })
  else router.push('/search')
}

export function showNewChat() {
  if (isWide()) set({ overlay: 'new' })
  else router.push('/new')
}

/** Back from a thread / transcript: closes the pane (wide) or pops the screen. */
export function closeThread() {
  if (isWide()) { openThread(null); set({ pane: { kind: 'thread' } }); return }
  if (router.canGoBack()) router.back()
  else router.replace('/')
}
