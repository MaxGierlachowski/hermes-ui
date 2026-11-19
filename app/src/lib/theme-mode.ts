// Light / dark / system. Native: NativeWind follows the OS for "system". Web: theme-mode.web.ts.
import { colorScheme } from 'nativewind'

export type ThemeMode = 'system' | 'light' | 'dark'
export const applyTheme = (mode: ThemeMode) => colorScheme.set(mode)
