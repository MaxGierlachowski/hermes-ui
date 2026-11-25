// Tooltips for the web / desktop build, like the web UI's (radix) tooltips: icon-only buttons show
// their accessibility label after a short hover (at once while moving between buttons), on keyboard
// focus too, below the button or above it at the window's bottom edge. One DOM element for the whole
// app, so the buttons need no wrapper: an element opts in by being an icon-only button with an
// aria-label, or explicitly with `dataSet={{ tip: '…' }}` (`tip: 'off'` opts out).
import { isWebDesktop } from './web-input'

const SELECTOR = '[data-tip], [role="button"][aria-label], button[aria-label], [role="tab"][aria-label], a[aria-label]'
const DELAY = 400
const WARM = 600 // after a tooltip closed, the next one opens without delay within this time

function labelOf(node: EventTarget | null): { el: HTMLElement; label: string } | null {
  const el = (node as Element | null)?.closest?.(SELECTOR) as HTMLElement | null
  if (!el || el.dataset.tip === 'off' || el.getAttribute('aria-disabled') === 'true') return null
  const label = el.dataset.tip || el.getAttribute('aria-label')
  // A button that shows its text needs no tooltip repeating it.
  if (!label || (!el.dataset.tip && el.textContent?.trim())) return null
  return { el, label }
}

export function setupTooltips() {
  if (!isWebDesktop || typeof document === 'undefined') return () => {}
  const tip = document.createElement('div')
  tip.className = 'hk-tip'
  tip.setAttribute('role', 'tooltip')
  document.body.appendChild(tip)
  let current: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let closedAt = 0

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const t = tip.getBoundingClientRect()
    const below = r.bottom + 6 + t.height < window.innerHeight - 4
    const top = below ? r.bottom + 6 : r.top - 6 - t.height
    const left = Math.max(4, Math.min(window.innerWidth - t.width - 4, r.left + r.width / 2 - t.width / 2))
    tip.style.top = `${Math.round(top)}px`
    tip.style.left = `${Math.round(left)}px`
    tip.style.transformOrigin = below ? 'top center' : 'bottom center'
  }
  const show = (el: HTMLElement, label: string) => {
    tip.textContent = label
    place(el)
    tip.dataset.open = '1'
  }
  const hide = () => {
    clearTimeout(timer)
    if (tip.dataset.open) closedAt = Date.now()
    delete tip.dataset.open
    current = null
  }
  const arm = (hit: { el: HTMLElement; label: string }) => {
    if (hit.el === current) return
    hide()
    current = hit.el
    timer = setTimeout(() => { if (current === hit.el && hit.el.isConnected) show(hit.el, hit.label) }, Date.now() - closedAt < WARM ? 0 : DELAY)
  }

  const onOver = (e: MouseEvent) => { const hit = labelOf(e.target); if (hit) arm(hit); else if (current) hide() }
  const onOut = (e: MouseEvent) => { if (current && !current.contains(e.relatedTarget as Node | null)) hide() }
  const onFocus = (e: FocusEvent) => {
    const el = e.target as HTMLElement
    if (!el.matches?.(':focus-visible')) return
    const hit = labelOf(el)
    if (hit) arm(hit)
  }
  const onHide = () => { if (current) hide() }
  document.addEventListener('mouseover', onOver)
  document.addEventListener('mouseout', onOut)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onHide)
  document.addEventListener('pointerdown', onHide, true)
  document.addEventListener('keydown', onHide, true)
  window.addEventListener('wheel', onHide, { passive: true, capture: true })
  window.addEventListener('blur', onHide)
  return () => {
    hide()
    tip.remove()
    document.removeEventListener('mouseover', onOver)
    document.removeEventListener('mouseout', onOut)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onHide)
    document.removeEventListener('pointerdown', onHide, true)
    document.removeEventListener('keydown', onHide, true)
    window.removeEventListener('wheel', onHide, { capture: true } as EventListenerOptions)
    window.removeEventListener('blur', onHide)
  }
}
