import { useEffect, useMemo, useState } from 'react'
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanOverlay } from '@/components/ui/kanban'
import { cn } from '@/lib/utils'
import { COLUMNS, type Column, type Session } from '@/lib/types'
import { openThread, setColumn, useBoard } from '@/lib/store'
import { SessionCard } from './SessionCard'
import { COLUMN_COLOR } from './status'
import { useIsMobile } from '@/hooks/use-mobile'
import { t } from '@/lib/i18n'

type Cols = Record<Column, Session[]>

function useColumns(): Cols {
  const sessions = useBoard((s) => s.sessions)
  const search = useBoard((s) => s.search)
  const source = useBoard((s) => s.source)
  return useMemo(() => {
    const q = search.trim().toLowerCase()
    const cols: Cols = { new: [], doing: [], waiting: [], done: [] }
    for (const s of Object.values(sessions)) {
      if (source && s.source !== source) continue
      if (q && !`${s.title} ${s.initialPrompt} ${s.activity}`.toLowerCase().includes(q)) continue
      cols[s.column]?.push(s)
    }
    // Open questions first, then most recent activity.
    for (const c of Object.values(cols)) c.sort((a, b) => (b.pending?.length ? 1 : 0) - (a.pending?.length ? 1 : 0) || b.updatedAt - a.updatedAt)
    return cols
  }, [sessions, search, source])
}

function ColumnHeader({ id, label, count }: { id: Column; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2 text-[12.5px] font-medium text-muted-foreground">
      <span className={cn('size-2 rounded-full', COLUMN_COLOR[id])} />
      <span className="text-foreground/90">{label}</span>
      <span className="tabular-nums">{count}</span>
    </div>
  )
}

export function Board() {
  const isMobile = useIsMobile()
  const cols = useColumns()
  return isMobile ? <MobileBoard cols={cols} /> : <DesktopBoard cols={cols} />
}

function DesktopBoard({ cols }: { cols: Cols }) {
  const openId = useBoard((s) => s.openId)
  const flash = useBoard((s) => s.flash)
  const [drag, setDrag] = useState<Cols | null>(null)
  const value = drag ?? cols
  const byId = useMemo(() => Object.fromEntries(Object.values(cols).flat().map((s) => [s.id, s])), [cols])

  return (
    <Kanban<Session>
      value={value}
      onValueChange={(v) => setDrag(v as Cols)}
      getItemValue={(s) => s.id}
      onDragEnd={(e) => {
        const id = String(e.active.id)
        const target = drag && (Object.keys(drag) as Column[]).find((c) => drag[c].some((s) => s.id === id))
        setDrag(null)
        if (target && byId[id] && byId[id].column !== target) setColumn(id, target)
      }}
      onDragCancel={() => setDrag(null)}
    >
      <KanbanBoard className="grid h-full min-h-0 grid-cols-4 gap-3 p-3">
        {COLUMNS.map(({ id, label }) => (
          <KanbanColumn key={id} value={id} className="flex min-h-0 flex-col rounded-xl bg-muted/40 p-2 ring-1 ring-border/60 data-[dragging]:ring-primary/30">
            <ColumnHeader id={id} label={label} count={value[id].length} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              <div className="flex flex-col gap-2 pb-2">
                {value[id].map((s) => (
                  <KanbanItem key={s.id} value={s.id} asHandle className="cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openThread(s.id)}>
                    <SessionCard s={s} selected={s.id === openId} flash={s.id === flash} />
                  </KanbanItem>
                ))}
                {!value[id].length && <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground/70">{t('Keine Karten')}</div>}
              </div>
            </div>
          </KanbanColumn>
        ))}
      </KanbanBoard>
      <KanbanOverlay>
        {({ value: v, variant }) => (variant === 'item' && byId[String(v)] ? <SessionCard s={byId[String(v)]} overlay /> : null)}
      </KanbanOverlay>
    </Kanban>
  )
}

function MobileBoard({ cols }: { cols: Cols }) {
  const [tab, setTab] = useState<Column>('waiting')
  const openId = useBoard((s) => s.openId)
  // Jump to the column that needs attention first.
  useEffect(() => { if (cols.waiting.some((s) => s.pending?.length)) setTab('waiting') }, [cols.waiting])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-4 gap-1 border-b px-2 py-2">
        {COLUMNS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn('flex items-center justify-center gap-1.5 rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors', tab === id && 'bg-muted text-foreground')}
          >
            <span className={cn('size-1.5 rounded-full', COLUMN_COLOR[id])} />
            {label.replace(' Task', '')}
            <span className="tabular-nums opacity-70">{cols[id].length}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-24">
        <div className="flex flex-col gap-2">
          {cols[tab].map((s) => (
            <button key={s.id} className="text-left" onClick={() => openThread(s.id)}>
              <SessionCard s={s} selected={s.id === openId} />
            </button>
          ))}
          {!cols[tab].length && <div className="py-10 text-center text-sm text-muted-foreground">{t('Keine Karten')}</div>}
        </div>
      </div>
    </div>
  )
}
