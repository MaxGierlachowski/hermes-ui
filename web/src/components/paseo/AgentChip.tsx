import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentState, PaseoChip } from '@/lib/types'
import { t } from '@/lib/i18n'

export const AGENT_STATE: Record<AgentState, { label: string; dot: string; text?: string }> = {
  running: { label: t('läuft'), dot: 'bg-indigo-500 animate-pulse' },
  'needs-attention': { label: t('wartet auf Freigabe'), dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  finished: { label: t('fertig'), dot: 'bg-emerald-500' },
  idle: { label: 'idle', dot: 'bg-zinc-400' },
  closed: { label: t('beendet'), dot: 'bg-zinc-400' },
  error: { label: t('Fehler'), dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  archived: { label: t('archiviert'), dot: 'bg-zinc-300 dark:bg-zinc-600' },
  unknown: { label: t('unbekannt'), dot: 'bg-zinc-300' },
}

export function AgentStateDot({ state, className }: { state: AgentState; className?: string }) {
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', AGENT_STATE[state]?.dot, className)} />
}

/** Compact chip for the board card: title + state, archived ones greyed out. */
export function AgentChip({ a }: { a: PaseoChip }) {
  const st = AGENT_STATE[a.state] || AGENT_STATE.unknown
  return (
    <span
      title={`Paseo: ${a.title || a.id} · ${st.label}${a.account ? ` · Account ${a.account}` : ''}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground',
        a.archived && 'opacity-50',
        st.text,
      )}
    >
      <Bot className="size-3 shrink-0" />
      <AgentStateDot state={a.state} />
      <span className="truncate">{a.title || a.id.slice(0, 8)}</span>
    </span>
  )
}
