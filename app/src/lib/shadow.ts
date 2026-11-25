// Shadows like the web UI (Tailwind v4 / shadcn: 5–10 % black). Set as the `boxShadow` style, which web
// and the new architecture on iOS / Android both draw: NativeWind's `shadow-*` classes become RN shadow
// props with 35 % opacity, far heavier than the web UI. In dark mode shadcn relies on borders instead.
import type { ViewStyle } from 'react-native'

export const SHADOW = {
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
} as const

/** `style={shadow('sm')}`; pass `dark` to drop it in dark mode (borders carry the edge there). */
export const shadow = (level: keyof typeof SHADOW, dark = false): ViewStyle => (dark ? {} : ({ boxShadow: SHADOW[level] } as ViewStyle))
