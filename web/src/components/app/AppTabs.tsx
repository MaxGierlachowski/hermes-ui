import { Inbox, LayoutGrid } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { badgeCount, setTab, useBoard } from '@/lib/store'
import type { Tab } from '@/lib/types'
import { t } from '@/lib/i18n'

/** Open requests make the badge amber; only unread history keeps it neutral. */
function CountBadge({ className }: { className?: string }) {
  const open = useBoard((s) => s.inbox.open.length)
  const n = useBoard((s) => badgeCount(s))
  if (!n) return null
  return (
    <span className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none', open ? 'bg-amber-500 text-white dark:text-zinc-950' : 'bg-muted-foreground/20 text-foreground', className)}>
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function HeaderTabs() {
  const tab = useBoard((s) => s.tab)
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="ml-3 hidden md:flex">
      <TabsList className="h-8">
        <TabsTrigger value="board" className="px-2.5 text-xs"><LayoutGrid className="size-3.5" />{t('Board')}</TabsTrigger>
        <TabsTrigger value="inbox" className="px-2.5 text-xs"><Inbox className="size-3.5" />{t('Inbox')}<CountBadge /></TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

/**
 * Mobile: bottom tab bar in the page colour (= theme-color, manifest colours, html background), running
 * through the home-indicator / gesture-bar area (padding = safe-area inset) so there is no seam at the edge.
 */
export function BottomTabBar() {
  const tab = useBoard((s) => s.tab)
  const items: { id: Tab; label: string; Icon: typeof Inbox }[] = [
    { id: 'board', label: t('Board'), Icon: LayoutGrid },
    { id: 'inbox', label: t('Inbox'), Icon: Inbox },
  ]
  return (
    <nav role="tablist" aria-label={t('Ansicht')} className="grid shrink-0 grid-cols-2 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          onClick={() => setTab(id)}
          className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors', tab === id && 'text-foreground')}
        >
          <span className="relative">
            <Icon className="size-5" strokeWidth={tab === id ? 2.2 : 1.8} />
            {id === 'inbox' && <CountBadge className="absolute -right-3 -top-1.5" />}
          </span>
          {label}
        </button>
      ))}
    </nav>
  )
}
