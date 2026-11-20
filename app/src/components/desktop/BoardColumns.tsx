// The board as columns side by side: all four on the desktop, two at a time (with snap scrolling) on a
// tablet or in a narrow window. Cards can be dragged between columns and have a right-click menu
// (web / desktop); the keyboard selection is drawn as a ring.
import { memo, useRef, type ComponentRef } from 'react'
import { FlatList, ScrollView, View, useWindowDimensions } from 'react-native'
import { COLUMNS, type Column, type Session } from '@shared/types'
import { Text } from '@/components/ui/text'
import { SessionCard } from '@/components/SessionCard'
import { LoadMoreFooter, onColumnScroll } from '@/components/LoadMore'
import { COLUMN_COLOR } from '@/components/status'
import { setColumn, prefetchThread } from '@/lib/store'
import { useCardDrag, useColumnDrop } from '@/lib/web-input'
import { openMenu } from '@/lib/menu'
import { showThread } from '@/lib/nav'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import { isWebDesktop as D } from '@/lib/web-input'

export function cardMenu(s: Session, at: { x: number; y: number }) {
  openMenu([
    { id: 'open', text: t('Öffnen') },
    '-',
    ...COLUMNS.map((c) => ({ id: `col:${c.id}`, text: `${t('Verschieben nach')} ${c.label}`, enabled: s.column !== c.id })),
    { id: 'col:auto', text: t('Spalte automatisch'), enabled: !!s.override },
    '-',
    { id: 'copy-title', text: t('Titel kopieren') },
    { id: 'copy-id', text: t('Session-ID kopieren') },
  ], at, (id) => {
    if (id === 'open') showThread(s.id)
    else if (id.startsWith('col:')) setColumn(s.id, id.slice(4) as Column | 'auto')
    else if (id === 'copy-title') copyText(s.title || '')
    else if (id === 'copy-id') copyText(s.id)
  })
}

const Card = memo(function Card({ s, selected, open }: { s: Session; selected: boolean; open: boolean }) {
  const ref = useRef<ComponentRef<typeof View>>(null)
  useCardDrag(ref, s.id, (at) => cardMenu(s, at))
  return (
    // Selected / open / focus rings are outlines drawn inside the card itself (CSS for data-hk-card in
    // PlatformShell.web.tsx): the column's scroll area clips anything outside, which cut off the top
    // card's ring; on this wrapper they would sit under the card's background.
    <View ref={ref} {...({ dataSet: { hkCard: selected ? 'selected' : open ? 'open' : '' } } as object)} className={D ? 'rounded-lg' : 'rounded-xl'}>
      <SessionCard s={s} onPress={() => showThread(s.id)} onLongPress={() => prefetchThread(s.id)} />
    </View>
  )
})

const BoardColumn = memo(function BoardColumn({ col, list, width, selected, openId }: { col: Column; list: Session[]; width: number | undefined; selected: number; openId: string | null }) {
  const ref = useRef<ComponentRef<typeof View>>(null)
  const over = useColumnDrop(ref, (id) => setColumn(id, col))
  const meta = COLUMNS.find((c) => c.id === col)!
  return (
    // Fixed width when the columns scroll sideways (tablet); flex-1 would shrink them to nothing there.
    // The web board's column: a quiet tray (muted/40, hairline border), header text 12.5 px.
    <View ref={ref} className={cn('rounded-xl border border-border/60 bg-muted/40 web:transition-colors', !width && 'flex-1', over && 'border-primary/40 bg-primary/5')} style={width ? { width } : undefined}>
      <View className={cn('flex-row items-center gap-2 px-3', D ? 'h-9 pt-0.5' : 'h-10')}>
        <View className={cn('h-2 w-2 rounded-full', COLUMN_COLOR[col])} />
        <Text className={cn('font-medium text-foreground/90', D ? 'text-[12.5px]' : 'text-[13px]')}>{meta.label}</Text>
        <Text className={cn('font-medium tabular-nums text-muted-foreground', D ? 'text-[12.5px]' : 'text-[13px]')}>{list.length}</Text>
      </View>
      <FlatList
        data={list}
        keyExtractor={(s) => s.id}
        contentContainerClassName="gap-2 px-2 pb-2"
        renderItem={({ item, index }) => <Card s={item} selected={index === selected} open={item.id === openId} />}
        ListEmptyComponent={<View className="rounded-lg border border-dashed border-border px-3 py-6"><Text className="text-center text-xs text-muted-foreground/70">{t('Keine Karten')}</Text></View>}
        ListFooterComponent={LoadMoreFooter}
        onScroll={onColumnScroll}
        scrollEventThrottle={100}
        removeClippedSubviews={false}
      />
    </View>
  )
})

/** `visible` columns fit the width; more scroll horizontally with snap (tablet: 2). */
export function BoardColumns({ lists, visible, selection, openId }: { lists: Record<Column, Session[]>; visible: 2 | 4; selection: { col: number; idx: number } | null; openId: string | null }) {
  const { width: win } = useWindowDimensions()
  const cols = COLUMNS.map((c, i) => (
    <BoardColumn key={c.id} col={c.id} list={lists[c.id]} width={visible === 2 ? (win - 36) / 2 : undefined} selected={selection?.col === i ? selection.idx : -1} openId={openId} />
  ))
  if (visible === 4) return <View className="flex-1 flex-row gap-3 p-3">{cols}</View>
  return (
    <ScrollView horizontal snapToInterval={(win - 36) / 2 + 12} decelerationRate="fast" showsHorizontalScrollIndicator={false} contentContainerClassName="flex-grow gap-3 p-3">
      {cols}
    </ScrollView>
  )
}
