/** @type {import('tailwindcss').Config} */
// Colours are the web UI's tokens (src/global.css); status colours as in the web board.
const token = (name) => `hsl(var(--${name}) / <alpha-value>)`
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        destructive: { DEFAULT: token('destructive') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
      },
      // The web UI's radius scale (shadcn: --radius 8 px × 0.6 / 0.8 / 1 / 1.4 / 1.8), in px so native resolves it too.
      borderRadius: { sm: '5px', md: '6px', lg: '8px', xl: '11px', '2xl': '14px' },
      // Geist on web and desktop (font files from scripts/web-vendor.mjs, @font-face in PlatformShell.web.tsx);
      // used as `web:font-sans`, so phones keep the system font.
      fontFamily: {
        sans: ['"Geist Variable"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
