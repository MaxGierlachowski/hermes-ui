// Web / desktop wrapper: desktop-grade defaults the RN-web reset does not give (focus rings for the
// keyboard only, selectable message text, thin overlay scrollbars, no rubber-banding of the whole
// window), the dock badge and the window title with the inbox count. Keyboard shortcuts and native
// menu actions are handled by DesktopHome, where the state they act on lives.
import { useEffect, type ReactNode } from 'react'
import { badgeCount, useStore } from '@/lib/store'
import { isDesktop, setBadge } from '@/lib/desktop'

const CSS = `
html, body, #root { height: 100%; overscroll-behavior: none; }
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:focus { outline: none; }
:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; border-radius: 8px; }
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
