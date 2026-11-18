import { useEffect, useMemo, useRef, useState } from 'react'
import type { SortingStrategy } from '@dnd-kit/sortable'
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanOverlay } from '@/components/ui/kanban'
import { cn } from '@/lib/utils'
import { COLUMNS, type Column, type Session } from '@/lib/types'
import { openThread, setColumn, useBoard } from '@/lib/store'
import { SessionCard } from './SessionCard'
import { COLUMN_COLOR } from './status'
import { useIsMobile } from '@/hooks/use-mobile'
import { OverlayScroll } from '@/components/common/OverlayScroll'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'
import { ColumnSheet } from './ColumnSheet'

type Cols = Record<Column, Session[]>

// Order inside a column is automatic: open questions first, then most recent activity.
const byAttention = (a: Session, b: Session) => (b.pending?.length ? 1 : 0) - (a.pending?.length ? 1 : 0) || b.updatedAt - a.updatedAt
// Cards never shift to make room inside a column (there is no manual order to keep), so a drop
// always lands on the slot the card will actually stay in.
const noShift: SortingStrategy = () => null
const sameCards = (a: Session[], b: Session[]) => a.length === b.length && a.every((s) => b.some((x) => x.id === s.id))

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
    for (const c of Object.values(cols)) c.sort(byAttention)
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
      strategy={noShift}
      onValueChange={(v) => {
        // Only a change of column counts; the card shows at its sorted place in the column it is over.
        const next = v as Cols
        if (COLUMNS.every(({ id }) => sameCards(next[id], value[id]))) return
        setDrag(Object.fromEntries(COLUMNS.map(({ id }) => [id, [...next[id]].sort(byAttention)])) as Cols)
      }}
      getItemValue={(s) => s.id}
      onDragEnd={(e) => {
        const id = String(e.active.id)
        const target = drag && (Object.keys(drag) as Column[]).find((c) => drag[c].some((s) => s.id === id))
        setDrag(null)
        // Same render as the drop: the store already has the card in its new column, so the
        // overlay animates there instead of back to where the drag started.
        if (target && byId[id] && byId[id].column !== target) setColumn(id, target)
      }}
      onDragCancel={() => setDrag(null)}
    >
      <KanbanBoard className="grid h-full min-h-0 grid-cols-4 gap-3 p-3">
        {COLUMNS.map(({ id, label }) => (
          <KanbanColumn key={id} value={id} className="flex min-h-0 flex-col rounded-xl bg-muted/40 p-2 ring-1 ring-border/60 data-[dragging]:ring-primary/30">
            <ColumnHeader id={id} label={label} count={value[id].length} />
            <OverlayScroll className="flex-1">
              <div className="flex flex-col gap-2 pb-2">
                {value[id].map((s) => (
                  <KanbanItem key={s.id} value={s.id} asHandle className="cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openThread(s.id)}>
                    <SessionCard s={s} selected={s.id === openId} flash={s.id === flash} />
                  </KanbanItem>
                ))}
                {!value[id].length && <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground/70">{t('Keine Karten')}</div>}
              </div>
            </OverlayScroll>
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
  const [moving, setMoving] = useState<Session | null>(null)
  const openId = useBoard((s) => s.openId)
  // Jump to the column that needs attention first.
  useEffect(() => { if (cols.waiting.some((s) => s.pending?.length)) setTab('waiting') }, [cols.waiting])
  const go = (id: Column) => { if (id !== tab) { haptic(5); setTab(id) } }
  // Horizontal swipe on the list switches to the neighbouring column.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { const p = e.touches[0]; swipe.current = { x: p.clientX, y: p.clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipe.current
    swipe.current = null
    if (!start || moving) return
    const p = e.changedTouches[0]
    const dx = p.clientX - start.x
    const dy = p.clientY - start.y
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const i = COLUMNS.findIndex((c) => c.id === tab)
    const next = COLUMNS[i + (dx < 0 ? 1 : -1)]
    if (next) go(next.id)
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={t('Spalten')} className="grid grid-cols-4 gap-1 border-b px-2 py-1.5">
        {COLUMNS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => go(id)}
            className={cn('flex h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted-foreground transition-colors active:bg-muted/60', tab === id && 'bg-muted text-foreground')}
          >
            <span className={cn('size-2 rounded-full', COLUMN_COLOR[id])} />
            {label.replace(' Task', '')}
            <span className="tabular-nums opacity-70">{cols[id].length}</span>
          </button>
        ))}
      </div>
      <OverlayScroll className="flex-1" viewportClassName="px-3 py-3 pb-28">
        <div role="tabpanel" className="flex min-h-full flex-col gap-2" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {cols[tab].map((s) => (
            <MobileCard key={s.id} s={s} selected={s.id === openId} onMove={() => setMoving(s)} />
          ))}
          {!cols[tab].length && <div className="py-10 text-center text-sm text-muted-foreground">{t('Keine Karten')}</div>}
          {cols[tab].length > 0 && <p className="pt-2 text-center text-[11px] text-muted-foreground/70">{t('Lange drücken zum Verschieben · wischen für andere Spalten')}</p>}
        </div>
      </OverlayScroll>
      <ColumnSheet
        open={!!moving}
        onOpenChange={(o) => !o && setMoving(null)}
        title={moving?.title}
        current={moving?.override ? moving.column : 'auto'}
        onPick={(c) => moving && setColumn(moving.id, c)}
      />
    </div>
  )
}

/** Tap opens the thread; a long press (or the Android context-menu gesture) opens "move to column". */
function MobileCard({ s, selected, onMove }: { s: Session; selected: boolean; onMove: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cancel = () => { clearTimeout(timer.current); start.current = null }
  const longPress = () => { fired.current = true; haptic(15); onMove() }
  return (
    <button
      className="select-none rounded-lg text-left transition-transform [-webkit-touch-callout:none] active:scale-[0.985] motion-reduce:active:scale-100"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        clearTimeout(timer.current)
        timer.current = setTimeout(longPress, 480)
      }}
      onPointerMove={(e) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel() }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => { e.preventDefault(); if (!fired.current) longPress() }}
      onClick={() => { if (fired.current) { fired.current = false; return } openThread(s.id) }}
    >
      <SessionCard s={s} selected={selected} />
    </button>
  )
}
