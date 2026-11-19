// Cards per column, the same order everywhere: waiting-for-you first, then most recently active.
import { COLUMNS, type Column, type Session } from '@shared/types'

export const sortCards = (a: Session, b: Session) => (b.pending?.length || 0) - (a.pending?.length || 0) || b.updatedAt - a.updatedAt

export function groupSessions(sessions: Record<string, Session>) {
  const lists = { new: [], doing: [], waiting: [], done: [] } as Record<Column, Session[]>
  const pending = { new: false, doing: false, waiting: false, done: false } as Record<Column, boolean>
  for (const s of Object.values(sessions)) { lists[s.column].push(s); if (s.pending?.length) pending[s.column] = true }
  for (const c of COLUMNS) lists[c.id].sort(sortCards)
  const counts = Object.fromEntries(COLUMNS.map((c) => [c.id, lists[c.id].length])) as Record<Column, number>
  return { lists, counts, pending }
}
