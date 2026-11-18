import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/utils'

/**
 * Overlay scrollbar for any scroll container: the native bar is hidden (`scrollbar-none`, no layout
 * space), this thin thumb floats over the content and only shows on hover or while scrolling.
 * Render it as a sibling of the scroll element inside a `relative` parent.
 */
export function OverlayScrollbar({ scrollRef, className }: { scrollRef: RefObject<HTMLElement | null>; className?: string }) {
  const [m, setM] = useState({ size: 0, offset: 0, scrollable: false })
  const [scrolling, setScrolling] = useState(false)
  const [hover, setHover] = useState(false)
  const [drag, setDrag] = useState(false)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let hideTimer = 0
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const max = scrollHeight - clientHeight
      const size = Math.max(28, (clientHeight * clientHeight) / Math.max(scrollHeight, 1))
      setM({ size, offset: max > 0 ? ((clientHeight - size) * scrollTop) / max : 0, scrollable: max > 1 })
    }
    const onScroll = () => {
      update()
      setScrolling(true)
      clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => setScrolling(false), 900)
    }
    const host = track.current?.parentElement
    const enter = () => { update(); setHover(true) }
    const leave = () => setHover(false)
    // Content changes size without scrolling (streaming, images): follow it.
    const ro = new ResizeObserver(update)
    const observeChildren = () => { ro.disconnect(); ro.observe(el); for (const c of Array.from(el.children)) ro.observe(c) }
    const mo = new MutationObserver(observeChildren)
    observeChildren()
    mo.observe(el, { childList: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    host?.addEventListener('pointerenter', enter)
    host?.addEventListener('pointerleave', leave)
    update()
    return () => {
      clearTimeout(hideTimer)
      ro.disconnect(); mo.disconnect()
      el.removeEventListener('scroll', onScroll)
      host?.removeEventListener('pointerenter', enter)
      host?.removeEventListener('pointerleave', leave)
    }
  }, [scrollRef])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || e.pointerType === 'touch') return
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startTop = el.scrollTop
    const ratio = (el.scrollHeight - el.clientHeight) / Math.max(el.clientHeight - m.size, 1)
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    setDrag(true)
    const move = (ev: PointerEvent) => { el.scrollTop = startTop + (ev.clientY - startY) * ratio }
    const up = () => { setDrag(false); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up) }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const visible = m.scrollable && (scrolling || hover || drag)
  return (
    <div ref={track} aria-hidden className={cn('pointer-events-none absolute inset-y-1 right-0.5 z-10 w-2 transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0', className)}>
      {m.scrollable && (
        <div
          onPointerDown={onPointerDown}
          style={{ height: m.size, transform: `translateY(${m.offset}px)` }}
          className={cn(
            'ml-auto w-1.5 rounded-full bg-foreground/20 transition-[width,background-color] hover:w-2 hover:bg-foreground/35 [@media(pointer:fine)]:pointer-events-auto',
            drag && 'w-2 bg-foreground/45',
          )}
        />
      )}
    </div>
  )
}

/** Scroll container with an overlay scrollbar. `className` sizes the box, `viewportClassName` styles the scrolling element. */
export function OverlayScroll({ className, viewportClassName, children, viewportRef }: { className?: string; viewportClassName?: string; children: ReactNode; viewportRef?: RefObject<HTMLDivElement | null> }) {
  const own = useRef<HTMLDivElement>(null)
  const ref = viewportRef ?? own
  return (
    <div className={cn('relative min-h-0', className)}>
      <div ref={ref} className={cn('scrollbar-none size-full overflow-y-auto overscroll-contain', viewportClassName)}>{children}</div>
      <OverlayScrollbar scrollRef={ref} />
    </div>
  )
}
