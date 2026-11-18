import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Inbox as InboxIcon, LayoutGrid, Plus, Search, Settings, WifiOff } from 'lucide-react-native'
import { COLUMNS, type Column, type Session } from '@shared/types'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { SessionCard } from '@/components/SessionCard'
import { Inbox } from '@/components/Inbox'
import { COLUMN_COLOR } from '@/components/status'
import { badgeCount, bootstrap, loadSessions, openThread, setPrefs, setTab, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

function Header() {
  const live = useStore((s) => s.live)
  const gateway = useStore((s) => s.gateway)
  const tab = useStore((s) => s.tab)
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-row items-center gap-1 border-b border-border bg-background px-2 pb-1" style={{ paddingTop: insets.top + 4 }}>
      <View className="flex-1 flex-row items-center gap-2 pl-2">
        <Text className="text-lg font-semibold">{tab === 'inbox' ? 'Inbox' : 'Hermes'}</Text>
        <View className={cn('h-2 w-2 rounded-full', live && gateway ? 'bg-emerald-500' : live ? 'bg-amber-500' : 'bg-zinc-400')} accessibilityLabel={live ? 'live' : 'offline'} />
      </View>
      <Button variant="ghost" size="icon" onPress={() => router.push('/search')} accessibilityLabel={t('Suche')}><Icon as={Search} /></Button>
      <Button variant="ghost" size="icon" onPress={() => router.push('/settings')} accessibilityLabel={t('Einstellungen')}><Icon as={Settings} /></Button>
    </View>
  )
}

/** Columns as segment tabs with counts (the board on a phone is one column at a time). */
function ColumnTabs({ counts }: { counts: Record<Column, number> }) {
  const column = useStore((s) => s.column)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 py-3">
      {COLUMNS.map((c) => {
        const on = c.id === column
        return (
          <Pressable
            key={c.id}
            onPress={() => { haptic('select'); setPrefs({ column: c.id }) }}
            className={cn('h-10 flex-row items-center gap-2 rounded-full border px-4', on ? 'border-primary bg-primary/10' : 'border-border bg-card')}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <View className={cn('h-2 w-2 rounded-full', COLUMN_COLOR[c.id])} />
            <Text className={cn('text-sm', on ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{c.label}</Text>
            <Text className="text-xs text-muted-foreground">{counts[c.id]}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

function Board() {
  const sessions = useStore((s) => s.sessions)
  const column = useStore((s) => s.column)
  const [refreshing, setRefreshing] = useState(false)
  const { list, counts } = useMemo(() => {
    const all = Object.values(sessions)
    const counts = { new: 0, doing: 0, waiting: 0, done: 0 } as Record<Column, number>
    for (const s of all) counts[s.column]++
    const list = all.filter((s) => s.column === column).sort((a, b) => (b.pending?.length || 0) - (a.pending?.length || 0) || b.updatedAt - a.updatedAt)
    return { list, counts }
  }, [sessions, column])
  const open = (s: Session) => { openThread(s.id); router.push(`/thread/${encodeURIComponent(s.id)}`) }
  return (
    <FlatList
      data={list}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={<ColumnTabs counts={counts} />}
      stickyHeaderIndices={[0]}
      contentContainerClassName="pb-36"
      ItemSeparatorComponent={() => <View className="h-2.5" />}
      renderItem={({ item }) => <View className="px-4"><SessionCard s={item} onPress={() => open(item)} /></View>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadSessions(); setRefreshing(false) }} />}
      ListEmptyComponent={<Text className="py-16 text-center text-muted-foreground">{t('Keine Chats in dieser Spalte.')}</Text>}
      initialNumToRender={12}
      windowSize={7}
    />
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
  const insets = useSafeAreaInsets()
  if (auth === 'unknown') return <View className="flex-1 bg-background" />
  if (auth === 'unpaired') return <Redirect href="/pair" />
  return (
    <View className="flex-1 bg-background">
      <Header />
      {auth === 'connecting' ? (
        <View className="flex-1 items-center justify-center gap-3"><ActivityIndicator size="large" /><Text className="text-muted-foreground">{t('Verbinde über iroh …')}</Text></View>
      ) : auth === 'ok' ? (
        <View className="flex-1">{tab === 'inbox' ? <Inbox /> : <Board />}</View>
      ) : <Offline />}
      {auth === 'ok' && tab === 'board' && (
        <Button size="lg" className="absolute right-4 rounded-full shadow-lg" style={{ bottom: insets.bottom + 72 }} onPress={() => router.push('/new')}>
          <Icon as={Plus} tone="primary-foreground" /><Text>{t('Neuer Chat')}</Text>
        </Button>
      )}
      <BottomBar />
    </View>
  )
}
