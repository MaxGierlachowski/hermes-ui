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

const CSS = `
html, body, #root { height: 100%; overscroll-behavior: none; }
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:focus { outline: none; }
:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
/* Board cards sit at the edge of a clipping scroll area: their rings go inside the card. */
[data-hk-card] :focus-visible { outline-offset: -2px; }
[data-hk-card="selected"] > * { outline: 2px solid hsl(var(--ring)); outline-offset: -2px; }
[data-hk-card="open"] > * { outline: 1px solid hsl(var(--primary) / 0.5); outline-offset: -1px; }
textarea:focus-visible, input:focus-visible { outline: none; }
::selection { background: hsl(var(--primary) / 0.25); }
.hk-thread, .hk-thread * { -webkit-user-select: text; user-select: text; }
.hk-thread [role="button"], .hk-thread button { -webkit-user-select: none; user-select: none; }
* { scrollbar-width: thin; scrollbar-color: hsl(var(--muted-foreground) / 0.35) transparent; }
${isDesktop ? 'html { cursor: default; } a, [role="button"], [role="tab"] { cursor: default; }' : ''}
[data-drop="1"] { box-shadow: inset 0 0 0 2px hsl(var(--primary)); border-radius: 12px; }
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
    return () => el.remove()
  }, [])
  useEffect(() => { setBadge(badge) }, [badge])
  useEffect(() => { document.title = badge ? `(${badge}) Hermes UI` : 'Hermes UI' }, [badge])
  return <>{children}</>
}
