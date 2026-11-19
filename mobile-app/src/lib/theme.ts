// The same tokens as hex, for places outside className (status/navigation bar, icons, navigation theme).
export const THEME = {
  light: {
    "background": "#fafafa",
    "foreground": "#09090b",
    "card": "#ffffff",
    "card-foreground": "#0a0a0a",
    "popover": "#ffffff",
    "popover-foreground": "#0a0a0a",
    "primary": "#615fff",
    "primary-foreground": "#fafafa",
    "secondary": "#f4f4f5",
    "secondary-foreground": "#171717",
    "muted": "#f4f4f5",
    "muted-foreground": "#71717b",
    "accent": "#f4f4f5",
    "accent-foreground": "#171717",
    "destructive": "#e7000b",
    "border": "#e4e4e7",
    "input": "#e4e4e7",
    "ring": "#615fff"
  },
  dark: {
    "background": "#09090b",
    "foreground": "#fafafa",
    "card": "#18181b",
    "card-foreground": "#fafafa",
    "popover": "#18181b",
    "popover-foreground": "#fafafa",
    "primary": "#615fff",
    "primary-foreground": "#fafafa",
    "secondary": "#27272a",
    "secondary-foreground": "#fafafa",
    "muted": "#18181b",
    "muted-foreground": "#9f9fa9",
    "accent": "#27272a",
    "accent-foreground": "#fafafa",
    "destructive": "#ff6467",
    "border": "#27272a",
    "input": "#27272a",
    "ring": "#615fff"
  },
} as const
export type ThemeName = keyof typeof THEME
