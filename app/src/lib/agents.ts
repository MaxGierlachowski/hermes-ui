// Agents of a chat: Paseo agents and the agents Hermes starts itself (delegate_task subagents and
// terminal `hermes chat` runs, provider 'hermes'). One list, one look; only the label and icon differ.
import { Bot, GitFork, SquareTerminal } from 'lucide-react-native'
import type { AgentMatch, PaseoChip } from '@shared/types'
import { t } from '@/lib/i18n'

type AgentLike = Pick<PaseoChip, 'provider' | 'kind' | 'account'> & { match?: AgentMatch }

export const isHermesAgent = (a: { provider?: string } | { id: string }) => ('provider' in a && a.provider === 'hermes') || ('id' in a && a.id.startsWith('hermes:'))

/** "Paseo" · "Subagent" · "Terminal · support" (the Hermes profile the run used). */
export function agentKindLabel(a: AgentLike) {
  if (a.provider !== 'hermes') return 'Paseo'
  const base = a.kind === 'terminal' ? t('Terminal') : t('Subagent')
  return a.account ? `${base} · ${a.account}` : base
}

export const agentIcon = (a: AgentLike) => (a.provider !== 'hermes' ? Bot : a.kind === 'terminal' ? SquareTerminal : GitFork)

/** Terminal runs carry no parent id in Hermes; they are tied to the chat by prompt or start time. */
export const agentMatchNote = (m?: AgentMatch) => (m === 'time' ? t('zugeordnet über die Startzeit (Heuristik)') : m === 'prompt' ? t('zugeordnet über den Prompt (Heuristik)') : null)

/** Read-only transcript of an agent. */
export const agentTimelinePath = (id: string) => (id.startsWith('hermes:') ? `/api/agents/${id}/timeline` : `/api/paseo/agents/${id}/timeline`)
