// Web: NativeWind's class-based dark mode (needed for the CSS variables) starts out "light" and does
// not follow the system for "system". Here "system" tracks prefers-color-scheme (macOS appearance in
// the desktop app) and sets light / dark explicitly.
import { colorScheme } from 'nativewind'

export type ThemeMode = 'system' | 'light' | 'dark'
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
let mode: ThemeMode = 'system'
mq?.addEventListener('change', () => { if (mode === 'system') colorScheme.set(mq.matches ? 'dark' : 'light') })

export function applyTheme(next: ThemeMode) {
  mode = next
  colorScheme.set(next === 'system' ? (mq?.matches ? 'dark' : 'light') : next)
}
