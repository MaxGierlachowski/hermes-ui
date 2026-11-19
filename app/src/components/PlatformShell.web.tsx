// Web / desktop wrapper: desktop-grade defaults the RN-web reset does not give (focus rings for the
// keyboard only, selectable message text, thin overlay scrollbars, no rubber-banding of the whole
// window), the dock badge and the window title with the inbox count. Keyboard shortcuts and native
// menu actions are handled by DesktopHome, where the state they act on lives.
import { useEffect, type ReactNode } from 'react'
import { badgeCount, useStore } from '@/lib/store'
import { isDesktop, onShellEvent, setBadge } from '@/lib/desktop'
import { setupNotifications } from '@/lib/notify'
import { setTab } from '@/lib/store'
import { showThread } from '@/lib/nav'
import { setupTooltips } from '@/lib/tooltip'

// Geist, the web UI's typeface (files copied by scripts/web-vendor.mjs; `web:font-sans` in Text / Input).
const FONT = (file: string, range: string) => `@font-face { font-family: 'Geist Variable'; font-style: normal; font-display: swap; font-weight: 100 900;
  src: url(${location.origin}/vendor/fonts/${file}) format('woff2'); unicode-range: ${range}; }`
const FONTS = [
  FONT('geist-latin-wght-normal.woff2', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'),
  FONT('geist-latin-ext-wght-normal.woff2', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'),
].join('\n')

const CSS = `
${FONTS}
html, body, #root { height: 100%; overscroll-behavior: none; }
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; font-feature-settings: "cv11", "ss01"; }
/* Focus: shadcn's 3 px ring at half strength, for the keyboard only. */
:focus { outline: none; }
:focus-visible { outline: 3px solid hsl(var(--ring) / 0.5); outline-offset: 0; }
/* Board cards sit at the edge of a clipping scroll area: their rings go inside the card. */
[data-hk-card] :focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: -2px; }
[data-hk-card="selected"] > * { outline: 2px solid hsl(var(--ring)); outline-offset: -2px; }
html:not(.dark) [data-hk-card] > *:hover { box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1); }
[data-hk-card="open"] > * { border-color: hsl(var(--primary) / 0.7) !important; box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15) inset; }
/* Text fields: the ring is the field's own border + shadow, on every focus (like the web UI's inputs). */
textarea:focus-visible, input:focus-visible { outline: none; }
textarea { field-sizing: content; }
[data-hk-field] { transition: border-color 150ms, box-shadow 150ms; }
[data-hk-field]:focus, [data-hk-field]:focus-within { border-color: hsl(var(--ring)) !important; box-shadow: 0 0 0 3px hsl(var(--ring) / 0.2); }
/* The prompt box: no ring (like the web UI's prompt input), only a slightly stronger border while typing. */
[data-hk-box] { transition: border-color 150ms; }
[data-hk-box]:focus-within { border-color: hsl(var(--ring) / 0.45) !important; }
::selection { background: hsl(var(--primary) / 0.25); }
::placeholder { color: hsl(var(--muted-foreground)); opacity: 1; }
.hk-thread, .hk-thread * { -webkit-user-select: text; user-select: text; }
.hk-thread [role="button"], .hk-thread button { -webkit-user-select: none; user-select: none; }
/* Scrollbars: thin and quiet (macOS draws them as overlays while scrolling). */
* { scrollbar-width: thin; scrollbar-color: hsl(var(--foreground) / 0.22) transparent; }
${isDesktop ? 'html { cursor: default; } a, [role="button"], [role="tab"] { cursor: default; }' : '[role="button"]:not([aria-disabled="true"]), [role="tab"], a { cursor: pointer; }'}
[data-drop="1"] { box-shadow: inset 0 0 0 2px hsl(var(--primary)); border-radius: 12px; }
/* An assistant message's time shows on hover, like the web UI, but without its fade: wheel-scrolling moves
   rows under a resting pointer, and a transition on each of them cost a 33 → 50 ms frame (measure-ui). */
[data-hk-ts] { opacity: 0; }
[data-hk-msg]:hover [data-hk-ts], [data-hk-ts]:focus-within { opacity: 1; }
/* Motion like the web UI's dialogs, popovers and tooltips (tailwindcss-animate: fade + zoom 95 %). */
@keyframes hk-fade-in { from { opacity: 0 } }
@keyframes hk-zoom-in { from { opacity: 0; transform: scale(0.96) } }
@keyframes hk-pop-in { from { opacity: 0; transform: scale(0.97) translateY(-2px) } }
[data-hk-anim="overlay"] { animation: hk-fade-in 150ms ease-out; }
[data-hk-anim="dialog"] { animation: hk-zoom-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
[data-hk-anim="menu"] { animation: hk-pop-in 120ms ease-out; transform-origin: top left; }
@media (prefers-reduced-motion: reduce) { [data-hk-anim], .hk-tip { animation: none !important; } }
/* Tooltip for icon buttons (tooltip.web.ts): shadcn's dark-on-light pill. */
.hk-tip { position: fixed; z-index: 100; pointer-events: none; max-width: 280px; padding: 6px 12px; border-radius: 6px;
  background: hsl(var(--foreground)); color: hsl(var(--background)); font: 500 12px/16px 'Geist Variable', -apple-system, sans-serif;
  white-space: nowrap; opacity: 0; transform: scale(0.95); transition: opacity 120ms ease-out, transform 120ms ease-out; }
.hk-tip[data-open="1"] { opacity: 1; transform: none; }
`

export function PlatformShell({ children }: { children: ReactNode }) {
  const badge = useStore((s) => badgeCount(s))
  const auth = useStore((s) => s.auth)
  // Desktop app: ask for notifications once there is something to notify about (first connection);
  // macOS shows its dialog only the first time, later calls just read the decision.
  useEffect(() => { if (isDesktop && auth === 'ok') setupNotifications(true).catch(() => {}) }, [auth === 'ok'])
  // A click on a system notification: its chat, or the inbox.
  useEffect(() => onShellEvent<string>('notification-click', (session) => { if (session) showThread(session); else setTab('inbox') }), [])
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = CSS
    document.head.appendChild(el)
    const stopTips = setupTooltips()
    return () => { el.remove(); stopTips() }
  }, [])
  useEffect(() => { setBadge(badge) }, [badge])
  useEffect(() => { document.title = badge ? `(${badge}) Hermes UI` : 'Hermes UI' }, [badge])
  return <>{children}</>
}
