// Effective touch-target size of every interactive element on screen, measured by hit-testing rather than
// by box size: a 32 px icon button whose ::after extends the hit area to 44 px passes, a 44 px button half
// covered by its neighbour fails. Each element must answer elementFromPoint at its centre ± (min/2 − 1) px
// on both axes (clamped to the viewport).
import type { Page } from '@playwright/test'

export type TargetResult = { label: string; tag: string; w: number; h: number; misses: string[] }

const INTERACTIVE = [
  'button', 'a[href]', 'input:not([type=hidden])', 'textarea', 'select', 'summary', 'audio[controls]',
  '[role=button]', '[role=tab]', '[role=checkbox]', '[role=switch]', '[role=option]', '[role=menuitem]', '[role=radio]', '[role=combobox]',
].join(',')

export function measureTargets(page: Page, min = 44): Promise<TargetResult[]> {
  return page.evaluate(({ min, selector }) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const out: TargetResult[] = []
    const label = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('name') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50)
    // Visible part of the element: viewport ∩ every clipping ancestor.
    // Area the element can be seen in: viewport ∩ every clipping (scrolling) ancestor.
    const clipRect = (el: Element) => {
      let left = 0, top = 0, right = vw, bottom = vh
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a)
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const ar = a.getBoundingClientRect()
          left = Math.max(left, ar.left); top = Math.max(top, ar.top); right = Math.min(right, ar.right); bottom = Math.min(bottom, ar.bottom)
        }
      }
      return { left, top, right, bottom }
    }
    const visibleRect = (el: Element) => {
      const r = el.getBoundingClientRect()
      const c = clipRect(el)
      return { r, c, left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) }
    }
    // Disabled controls keep their size once enabled: measure them too (they are pointer-events: none).
    // Floating controls over the edge of a scroll area ([data-scroll-overlay], e.g. the Summary pill):
    // a row under them is at the scroll edge for the moment (the list's padding lets it scroll clear),
    // like a row partly scrolled away. The floating controls themselves are measured as usual.
    const overlays = Array.from(document.querySelectorAll('[data-scroll-overlay] *'))
      .filter((o) => getComputedStyle(o).pointerEvents !== 'none').map((o) => o.getBoundingClientRect())
    const underOverlay = (el: Element, r: DOMRect) => !el.closest('[data-scroll-overlay]')
      && overlays.some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top)
    const disabled = Array.from(document.querySelectorAll<HTMLElement>(':disabled,[aria-disabled=true],[data-disabled]'))
    const saved = disabled.map((el) => el.style.pointerEvents)
    disabled.forEach((el) => { el.style.pointerEvents = 'auto' })
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (el.closest('[aria-hidden=true],[inert],[data-touch-exempt]')) continue
      // Inline links inside running text are exempt (WCAG 2.5.8 "inline" exception).
      if (el.tagName === 'A' && el.closest('.prose')) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) continue
      const { r, c, left, top, right, bottom } = visibleRect(el)
      if (r.width < 1 || r.height < 1) continue
      // Only elements fully on screen: partly scrolled-away ones are checked once they are scrolled in.
      if (right - left < r.width - 1 || bottom - top < r.height - 1) continue
      if (c.bottom < vh && underOverlay(el, r)) continue // in a scroll area, under a floating control at its edge
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const own = (x: number, y: number) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)) }
      if (!own(cx, cy)) continue // covered entirely (e.g. behind a dialog): not reachable, not on screen
      const d = min / 2 - 1
      // A probe past the edge of a scroll area is clamped to it: that part of the target is scrolled
      // away for the moment, not too small.
      const clampX = (x: number) => Math.min(c.right - 1, Math.max(c.left, x))
      const clampY = (y: number) => Math.min(c.bottom - 1, Math.max(c.top, y))
      const probes: [string, number, number][] = [['left', clampX(cx - d), cy], ['right', clampX(cx + d), cy], ['top', cx, clampY(cy - d)], ['bottom', cx, clampY(cy + d)]]
      const misses = probes.filter(([, x, y]) => !own(x, y)).map(([n]) => n)
      if (misses.length) out.push({ label: label(el), tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), misses })
    }
    disabled.forEach((el, i) => { el.style.pointerEvents = saved[i] })
    return out
  }, { min, selector: INTERACTIVE })
}

/** iOS Safari zooms into any focused field with a font size below 16 px. */
export function smallInputs(page: Page): Promise<{ label: string; fontSize: number }[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [contenteditable=true]'))
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => ({ label: (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.tagName).slice(0, 50), fontSize: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((x) => x.fontSize < 16))
}
