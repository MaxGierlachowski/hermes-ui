import { Bot, GitFork, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentMatch, AgentState, PaseoChip } from '@/lib/types'
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

// Paseo agents and the agents Hermes starts itself (provider 'hermes': delegate_task subagents, terminal
// `hermes chat` runs) share one list and one look; only label and icon differ.
type AgentLike = Pick<PaseoChip, 'provider' | 'kind' | 'account'>
export function AgentIcon({ a, className }: { a: AgentLike; className?: string }) {
  if (a.provider !== 'hermes') return <Bot className={className} />
  return a.kind === 'terminal' ? <SquareTerminal className={className} /> : <GitFork className={className} />
}
/** "Paseo" · "Subagent" · "Terminal · support" (the Hermes profile the run used). */
export function agentKindLabel(a: AgentLike) {
  if (a.provider !== 'hermes') return 'Paseo'
  const base = a.kind === 'terminal' ? t('Terminal') : t('Subagent')
  return a.account ? `${base} · ${a.account}` : base
}
/** Terminal runs carry no parent id in Hermes; they are tied to the chat by prompt or start time. */
export const agentMatchNote = (m?: AgentMatch) => (m === 'time' ? t('zugeordnet über die Startzeit (Heuristik)') : m === 'prompt' ? t('zugeordnet über den Prompt (Heuristik)') : null)
export const agentTimelinePath = (id: string) => (id.startsWith('hermes:') ? `/api/agents/${id}/timeline` : `/api/paseo/agents/${id}/timeline`)

export function AgentStateDot({ state, className }: { state: AgentState; className?: string }) {
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', AGENT_STATE[state]?.dot, className)} />
}

/** Compact chip for the board card: title + state, archived ones greyed out. */
export function AgentChip({ a }: { a: PaseoChip }) {
  const st = AGENT_STATE[a.state] || AGENT_STATE.unknown
  return (
    <span
      title={`${agentKindLabel(a)}: ${a.title || a.id} · ${st.label}${a.provider !== 'hermes' && a.account ? ` · Account ${a.account}` : ''}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground',
        a.archived && 'opacity-50',
        st.text,
      )}
    >
      <AgentIcon a={a} className="size-3 shrink-0" />
      <AgentStateDot state={a.state} />
      <span className="truncate">{a.title || a.id.slice(0, 8)}</span>
    </span>
  )
}
