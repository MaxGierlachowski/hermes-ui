// The inbox history as rows for web and mobile: chat and agent entries one by one, automation entries
// (cron runs, webhook runs, `POST /api/notify`) folded into one group per job, route or notify group.
// A group sits where its newest entry is, so the history stays newest first.
import type { InboxItem, InboxSource } from './types'

// Same list as AUTOMATION_SOURCES in types.ts; a type-only import keeps this file runnable under `node --test`.
const AUTOMATION_SOURCES: readonly InboxSource[] = ['cron', 'webhook', 'notify']

export type InboxKindFilter = 'all' | 'requests' | 'done' | 'error'
/** Chats = Hermes sessions, Agents = Paseo agents, Automations = cron, webhook, notify. */
export type InboxSourceFilter = 'all' | 'chats' | 'agents' | 'automations'

const REQUESTS = new Set(['approval', 'clarify', 'permission'])
const ERRORS = new Set(['error', 'paseo-error', 'paseo-limit'])

export const isRequest = (it: Pick<InboxItem, 'kind'>) => REQUESTS.has(it.kind)
export const isAutomation = (it: Pick<InboxItem, 'kind' | 'source'>) => it.kind === 'automation' || AUTOMATION_SOURCES.includes(it.source)
/** A failed or blocked run, a notify with level error, or a chat/agent error. */
export const isFailure = (it: Pick<InboxItem, 'kind' | 'source' | 'status'>) => (isAutomation(it) ? it.status === 'error' : ERRORS.has(it.kind))

export function matchesSource(source: InboxSource, f: InboxSourceFilter) {
  if (f === 'all') return true
  if (f === 'chats') return source === 'hermes'
  if (f === 'agents') return source === 'paseo'
  return AUTOMATION_SOURCES.includes(source)
}

export function matchesKind(it: Pick<InboxItem, 'kind' | 'source' | 'status'>, f: InboxKindFilter) {
  if (f === 'all') return true
  if (f === 'requests') return isRequest(it)
  if (f === 'error') return isFailure(it)
  return !isRequest(it) && !isFailure(it)
}

/** Older builds stored the source filter as hermes | paseo. */
export function sourceFilterFrom(v: string | null | undefined): InboxSourceFilter {
  if (v === 'hermes') return 'chats'
  if (v === 'paseo') return 'agents'
  return v === 'chats' || v === 'agents' || v === 'automations' ? v : 'all'
}

export type InboxGroup = {
  key: string
  source: InboxSource
  name: string
  /** Newest first. */
  items: InboxItem[]
  unread: number
  /** Time and status of the newest entry. */
  at: number
  status: 'ok' | 'error'
}

export type HistoryEntry = { type: 'item'; item: InboxItem; at: number } | { type: 'group'; group: InboxGroup; at: number }

export const groupName = (it: InboxItem) => it.group || it.title || it.source
export const groupKey = (it: InboxItem) => `${it.source}:${groupName(it)}`

/** Entries in history order (newest first); automation entries become one group per source + group name. */
export function historyEntries(items: InboxItem[]): HistoryEntry[] {
  const sorted = [...items].sort((a, b) => b.at - a.at)
  const out: HistoryEntry[] = []
  const groups = new Map<string, InboxGroup>()
  for (const item of sorted) {
    if (!isAutomation(item)) { out.push({ type: 'item', item, at: item.at }); continue }
    const key = groupKey(item)
    let g = groups.get(key)
    if (!g) {
      g = { key, source: item.source, name: groupName(item), items: [], unread: 0, at: item.at, status: isFailure(item) ? 'error' : 'ok' }
      groups.set(key, g)
      out.push({ type: 'group', group: g, at: item.at })
    }
    g.items.push(item)
    if (!item.read) g.unread++
  }
  return out
}
