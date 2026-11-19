import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Pressable, RefreshControl, View, useWindowDimensions } from 'react-native'
import { Pager, type PagerHandle } from '@/components/Pager'
import { FlashList } from '@shopify/flash-list'
import { Redirect, router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Inbox as InboxIcon, LayoutGrid, Plus, Search, Settings, WifiOff } from 'lucide-react-native'
import { COLUMNS, type Column, type Session } from '@shared/types'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { SessionCard } from '@/components/SessionCard'
import { Inbox } from '@/components/Inbox'
import { OfflineBanner, SyncBar } from '@/components/SyncBar'
import { badgeCount, bootstrap, exitDemo, loadSessions, prefetchThread, setPrefs, setTab, useStore } from '@/lib/store'
import { groupSessions } from '@/lib/board'
import { layoutFor, showNewChat, showSearch, showThread } from '@/lib/nav'
import { DesktopHome } from '@/components/desktop/DesktopHome'
import { BoardColumns } from '@/components/desktop/BoardColumns'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

function Header() {
  const demo = useStore((s) => s.demo)
  const live = useStore((s) => s.live)
  const gateway = useStore((s) => s.gateway)
  const tab = useStore((s) => s.tab)
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-row items-center gap-1 border-b border-border bg-background px-2 pb-1" style={{ paddingTop: insets.top + 4 }}>
      <View className="flex-1 flex-row items-center gap-2 pl-2">
        <Text className="text-lg font-semibold">{tab === 'inbox' ? 'Inbox' : 'Hermes'}</Text>
        <View className={cn('h-2 w-2 rounded-full', live && gateway ? 'bg-emerald-500' : live ? 'bg-amber-500' : 'bg-zinc-400')} accessibilityLabel={live ? 'live' : 'offline'} />
        {demo && (
          <Pressable onPress={async () => { await exitDemo(); router.replace('/pair') }} accessibilityRole="button" accessibilityLabel={t('Demo beenden')} hitSlop={8} className="ml-1 flex-row items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1">
            <Text className="text-xs font-semibold text-primary">{t('Demo')}</Text>
            <Text className="text-xs text-primary">· {t('beenden')}</Text>
          </Pressable>
        )}
      </View>
      <Button variant="ghost" size="icon" onPress={showSearch} accessibilityLabel={t('Suche')}><Icon as={Search} /></Button>
      <Button variant="ghost" size="icon" onPress={() => router.push('/settings')} accessibilityLabel={t('Einstellungen')}><Icon as={Settings} /></Button>
    </View>
  )
}

/**
 * Column tabs over the pager: equal segments, an underline that follows the finger while swiping
 * (driven natively by the pager's scroll position), a tap jumps to the column. Counts per column, and
 * an amber dot when a card in it waits for an answer.
 */
function ColumnTabs({ counts, pending, page, progress, onPick }: { counts: Record<Column, number>; pending: Record<Column, boolean>; page: number; progress: Animated.AnimatedInterpolation<number> | Animated.Value; onPick: (i: number) => void }) {
  const [width, setWidth] = useState(0)
  const seg = width / COLUMNS.length
  return (
    <View className="border-b border-border" onLayout={(e) => setWidth(e.nativeEvent.layout.width - 16)}>
      <View className="flex-row px-2">
        {COLUMNS.map((c, i) => {
          const on = i === page
          return (
            <Pressable key={c.id} onPress={() => onPick(i)} className="h-12 flex-1 flex-row items-center justify-center gap-1.5" accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${c.label} ${counts[c.id]}`}>
              <Text className={cn('text-[13.5px]', on ? 'font-semibold text-foreground' : 'text-muted-foreground')} numberOfLines={1}>{c.label}</Text>
              <View className={cn('h-[18px] min-w-[18px] items-center justify-center rounded-full px-1', on ? 'bg-primary/15' : 'bg-muted')}>
                <Text className={cn('text-[11px] tabular-nums', on ? 'font-semibold text-primary' : 'text-muted-foreground')}>{counts[c.id]}</Text>
              </View>
              {pending[c.id] && <View className="absolute right-1 top-2.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </Pressable>
          )
        })}
      </View>
      {seg > 0 && (
        <Animated.View
          className="absolute bottom-0 left-2 h-[3px] rounded-t-full bg-primary"
          style={{ width: seg, transform: [{ translateX: Animated.multiply(progress, seg) }] }}
        />
      )}
    </View>
  )
}

/** One column: its own list, own scroll position and pull to refresh. */
const ColumnPage = memo(function ColumnPage({ list }: { list: Session[] }) {
  const [refreshing, setRefreshing] = useState(false)
  const open = useCallback((s: Session) => showThread(s.id), [])
  return (
    <FlashList
      data={list}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 144 }}
      ItemSeparatorComponent={Gap}
      renderItem={({ item }) => <View className="px-4"><SessionCard s={item} onPress={() => open(item)} onLongPress={() => prefetchThread(item.id)} /></View>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadSessions(); setRefreshing(false) }} />}
      ListEmptyComponent={<Text className="py-16 text-center text-muted-foreground">{t('Keine Chats in dieser Spalte.')}</Text>}
    />
  )
})
const Gap = () => <View className="h-2.5" />

/** Tablet / narrow window: two columns side by side, the others a snap-scroll away. */
function TwoColumnBoard() {
  const sessions = useStore((s) => s.sessions)
  const openId = useStore((s) => s.openId)
  const { lists } = useMemo(() => groupSessions(sessions), [sessions])
  return <BoardColumns lists={lists} visible={2} selection={null} openId={openId} />
}

/** The board on a phone: the four columns as a horizontal pager (swipe with snap), tabs in sync. */
function Board() {
  const sessions = useStore((s) => s.sessions)
  const column = useStore((s) => s.column)
  const index = Math.max(0, COLUMNS.findIndex((c) => c.id === column))
  const pager = useRef<PagerHandle>(null)
  const page = useRef(index)
  const [shown, setShown] = useState(index)
  const position = useRef(new Animated.Value(index)).current
  const offset = useRef(new Animated.Value(0)).current
  const progress = useMemo(() => Animated.add(position, offset), [])

  const { lists, counts, pending } = useMemo(() => groupSessions(sessions), [sessions])

  // Column changed elsewhere (first load picks the first non-empty one): follow without animation.
  useEffect(() => {
    if (page.current === index) return
    page.current = index
    setShown(index)
    pager.current?.setPageWithoutAnimation(index)
  }, [index])

  return (
    <View className="flex-1">
      <ColumnTabs counts={counts} pending={pending} page={shown} progress={progress} onPick={(i) => { haptic('select'); pager.current?.setPage(i) }} />
      <Pager
        ref={pager}
        initialPage={index}
        position={position}
        offset={offset}
        onPageSelected={(i) => {
          if (i === page.current) return
          page.current = i
          setShown(i)
          haptic('select')
          setPrefs({ column: COLUMNS[i].id })
        }}
      >
        {COLUMNS.map((c) => <View key={c.id} collapsable={false} className="flex-1"><ColumnPage list={lists[c.id]} /></View>)}
      </Pager>
    </View>
  )
}

function BottomBar() {
  const tab = useStore((s) => s.tab)
  const badge = useStore((s) => badgeCount(s))
  const insets = useSafeAreaInsets()
  const Item = ({ id, icon, label }: { id: 'board' | 'inbox'; icon: typeof LayoutGrid; label: string }) => (
    <Pressable onPress={() => { haptic('select'); setTab(id) }} className="h-14 flex-1 items-center justify-center gap-0.5" accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
      <View>
        <Icon as={icon} size={22} tone={tab === id ? 'primary' : 'muted-foreground'} />
        {id === 'inbox' && badge > 0 && (
          <View className="absolute -right-2.5 -top-1.5 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1"><Text className="text-[11px] font-semibold text-primary-foreground">{badge > 99 ? '99+' : badge}</Text></View>
        )}
      </View>
      <Text className={cn('text-xs', tab === id ? 'font-medium text-primary' : 'text-muted-foreground')}>{label}</Text>
    </Pressable>
  )
  return (
    <View className="flex-row border-t border-border bg-background" style={{ paddingBottom: insets.bottom }}>
      <Item id="board" icon={LayoutGrid} label="Board" />
      <Item id="inbox" icon={InboxIcon} label="Inbox" />
    </View>
  )
}

const HIDDEN = { display: 'none' } as const

function Offline() {
  const auth = useStore((s) => s.auth)
  const error = useStore((s) => s.error)
  return (
    <View className="flex-1 items-center justify-center gap-4 p-8">
      <Icon as={WifiOff} size={36} tone="muted-foreground" />
      <Text className="text-center text-lg font-semibold">{auth === 'refused' ? t('Gerät nicht gekoppelt') : t('Backend nicht erreichbar')}</Text>
      <Text className="text-center text-sm text-muted-foreground">
        {auth === 'refused'
          ? t('Dieses Gerät ist nicht (mehr) für das Backend freigegeben. Erzeuge auf dem Rechner einen neuen Kopplungscode (Fernzugriff → Gerät koppeln oder `hermes-ui pair`) und scanne ihn.')
          : error || ''}
      </Text>
      <Button onPress={() => bootstrap()}><Text>{t('Erneut verbinden')}</Text></Button>
      <Button variant="outline" onPress={() => router.push('/pair')}><Text>{t('Neu koppeln')}</Text></Button>
    </View>
  )
}

export default function Home() {
  const auth = useStore((s) => s.auth)
  const tab = useStore((s) => s.tab)
  const hydrated = useStore((s) => s.hydrated)
  const insets = useSafeAreaInsets()
  const layout = layoutFor(useWindowDimensions().width)
  if (auth === 'unknown') return <View className="flex-1 bg-background" />
  if (auth === 'unpaired') return <Redirect href="/pair" />
  // With a cached board the app shows it at once, also while connecting or offline.
  const content = auth === 'ok' || (hydrated && (auth === 'connecting' || auth === 'offline'))
  if (layout === 'desktop' && content) return <DesktopHome />
  return (
    <View className="flex-1 bg-background">
      <Header />
      <SyncBar />
      <OfflineBanner />
      {content ? (
        // Both tabs stay mounted: switching is instant and keeps each one's scroll position.
        <View className="flex-1">
          <View className="flex-1" style={tab === 'inbox' ? HIDDEN : undefined}>{layout === 'tablet' ? <TwoColumnBoard /> : <Board />}</View>
          <View className="flex-1" style={tab === 'board' ? HIDDEN : undefined}><Inbox /></View>
        </View>
      ) : auth === 'connecting' ? (
        <View className="flex-1 items-center justify-center gap-3"><ActivityIndicator size="large" /><Text className="text-muted-foreground">{t('Verbinde über iroh …')}</Text></View>
      ) : <Offline />}
      {content && tab === 'board' && (
        <Button size="lg" className="absolute right-4 rounded-full shadow-lg" style={{ bottom: insets.bottom + 72 }} onPress={showNewChat}>
          <Icon as={Plus} tone="primary-foreground" /><Text>{t('Neuer Chat')}</Text>
        </Button>
      )}
      <BottomBar />
    </View>
  )
}
