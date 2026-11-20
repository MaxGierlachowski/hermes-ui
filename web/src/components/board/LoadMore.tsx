import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { loadMore, useBoard } from '@/lib/store'
import { t } from '@/lib/i18n'

const scrollParent = (el: HTMLElement | null): HTMLElement | null => {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

/**
 * End of a column / list: scrolling it into view loads the next older page. Only when the list
 * actually scrolls; a short column shows the button instead, so it never pages through the whole
 * history on its own.
 */
export function LoadMore() {
  const more = useBoard((s) => !!s.nextCursor)
  const loading = useBoard((s) => s.loadingMore)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !more) return
    const root = scrollParent(el)
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && root && root.scrollHeight > root.clientHeight + 1 && root.scrollTop > 0) loadMore()
    }, { root, rootMargin: '0px 0px 240px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more])

  if (!more) return null
  return (
    <button
      ref={ref}
      onClick={() => loadMore()}
      disabled={loading}
      className="flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-70"
    >
      {loading ? <><Loader2 className="size-3.5 animate-spin" />{t('Lädt …')}</> : t('Ältere Chats laden')}
    </button>
  )
}
