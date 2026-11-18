import { Bot, Clock, Laptop, MessageCircle, Terminal, Webhook, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Column } from '@/lib/types'

export const COLUMN_COLOR: Record<Column, string> = {
  new: 'bg-zinc-400 dark:bg-zinc-500',
  doing: 'bg-indigo-500',
  waiting: 'bg-amber-500',
  done: 'bg-emerald-500',
}

export function StatusDot({ column, running, pending, className }: { column: Column; running?: boolean; pending?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {(running || pending) && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', pending ? 'bg-amber-500' : COLUMN_COLOR[column])} />}
      <span className={cn('relative inline-flex size-2 rounded-full', pending ? 'bg-amber-500' : COLUMN_COLOR[column])} />
    </span>
  )
}

export function SourceIcon({ source, className }: { source: string; className?: string }) {
  const Icon = {
    slack: MessageCircle,
    desktop: Laptop,
    kanban: LayoutGrid,
    cron: Clock,
    webhook: Webhook,
    oneshot: Terminal,
    cli: Terminal,
  }[source] || Bot
  return <Icon className={className} />
}
