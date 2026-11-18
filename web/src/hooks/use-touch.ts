import { useEffect, useState } from 'react'
import { useIsMobile } from './use-mobile'

const COARSE = '(pointer: coarse)'

/** Touch layout: a phone-sized window or any touch screen (iPad). A desktop with a mouse never matches. */
export function useTouchUI() {
  const isMobile = useIsMobile()
  const [coarse, setCoarse] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(COARSE).matches)
  useEffect(() => {
    const mql = matchMedia(COARSE)
    const on = () => setCoarse(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return isMobile || coarse
}

/**
 * Keeps --keyboard-inset on <html> at the height the on-screen keyboard covers. iOS Safari overlays the
 * keyboard without resizing the page (interactive-widget is not supported there yet), so bottom-anchored
 * sheets and the composer move up by this much. On Android Chrome the viewport meta
 * interactive-widget=resizes-content already shrinks the page, and the inset stays 0.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
        // Below 80 px it is a toolbar or rounding, not a keyboard.
        root.style.setProperty('--keyboard-inset', `${inset > 80 ? inset : 0}px`)
        root.style.setProperty('--visual-height', `${Math.round(vv.height)}px`)
        root.classList.toggle('keyboard-open', inset > 80)
      })
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => { cancelAnimationFrame(frame); vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
}
