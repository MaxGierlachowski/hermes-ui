// Native builds have no desktop shell: the same API as desktop.web.ts, all no-ops.
import { Linking } from 'react-native'
import { classifyLink } from './links'
export const isDesktop = false
export const isMac = false
export const invoke = async <T,>(_cmd: string, _args?: Record<string, unknown>): Promise<T | null> => null
// Links: the system handles them (Linking); only http(s) and mailto: leave the app.
export async function openExternal(url: string): Promise<boolean> {
  if (classifyLink(url, 'app://local') !== 'external') return false
  try { await Linking.openURL(url); return true } catch { return false }
}
export const interceptExternalLinks = () => () => {}
export type LocalBackend = { baseUrl: string; token: string; managed: boolean }
export const localBackend = async (): Promise<LocalBackend | null> => null
export const onShellAction = (_fn: (id: string) => void) => () => {}
export const setBadge = async (_count: number) => {}
export const nativeMenu = async (_items: unknown[], _onPick: (id: string) => void) => false
export const onShellEvent = <T,>(_name: string, _fn: (payload: T) => void) => () => {}
