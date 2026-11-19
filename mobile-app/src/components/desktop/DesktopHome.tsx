// The wide layout (desktop app, browser window, large tablet): header with the window's drag region,
// the board as four columns, the chat in a resizable split pane next to it, search as the ⌘K palette
// and "new chat" as a dialog. Keyboard: ⌘K / ⌘N / ⌘1–4 / ↑↓←→ / Enter / Esc / ⌘, (see KEYS below).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Inbox as InboxIcon, LayoutGrid, Plus, Search, Settings, X } from 'lucide-react-native'
import { COLUMNS } from '@shared/types'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Inbox } from '@/components/Inbox'
import { OfflineBanner, SyncBar } from '@/components/SyncBar'
import { SearchPanel } from '@/components/SearchPanel'
import { Composer } from '@/components/Composer'
import { MenuHost } from '@/components/MenuHost'
import { ThreadPane } from '@/components/thread/ThreadPane'
import { PaseoPane } from '@/components/paseo/PaseoPane'
import { BoardColumns, cardMenu } from './BoardColumns'
import { badgeCount, createChat, exitDemo, setTab, toast, useStore } from '@/lib/store'
import { groupSessions } from '@/lib/board'
import { closeThread, setOverlay, setPane, showNewChat, showSearch, showThread, useNav } from '@/lib/nav'
import { useKeydown, useSplitResize } from '@/lib/web-input'
import { isDesktop, isMac, onShellAction } from '@/lib/desktop'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

// The macOS window has no title bar (Tauri titleBarStyle "Overlay"): the header is the drag region
// and leaves room for the traffic lights.
const TRAFFIC_LIGHTS = isDesktop && isMac ? 88 : 0
const drag = isDesktop ? ({ dataSet: { tauriDragRegion: '' } } as object) : {}

function Header() {
  const live = useStore((s) => s.live)
  const gateway = useStore((s) => s.gateway)
  const tab = useStore((s) => s.tab)
  const demo = useStore((s) => s.demo)
  const badge = useStore((s) => badgeCount(s))
  const Tab = ({ id, icon, label }: { id: 'board' | 'inbox'; icon: typeof LayoutGrid; label: string }) => (
    <Pressable onPress={() => setTab(id)} className={cn('h-8 flex-row items-center gap-1.5 rounded-md px-2.5 web:hover:bg-background/60', tab === id && 'bg-background shadow-sm')} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
      <Icon as={icon} size={15} tone={tab === id ? 'foreground' : 'muted-foreground'} />
      <Text className={cn('text-[13px]', tab === id ? 'font-medium' : 'text-muted-foreground')}>{label}</Text>
      {id === 'inbox' && badge > 0 && <View className="h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1"><Text className="text-[11px] font-semibold text-primary-foreground">{badge > 99 ? '99+' : badge}</Text></View>}
    </Pressable>
  )
  return (
    <View {...drag} className="h-[52px] flex-row items-center gap-3 border-b border-border bg-background pr-3" style={{ paddingLeft: TRAFFIC_LIGHTS || 16 }}>
      <View {...drag} className="flex-row items-center gap-2">
        <View className="h-6 w-6 items-center justify-center rounded-md bg-primary"><Text className="text-xs font-bold text-primary-foreground">H</Text></View>
        <Text {...drag} className="text-[15px] font-semibold">Hermes UI</Text>
        <View className={cn('h-2 w-2 rounded-full', live && gateway ? 'bg-emerald-500' : live ? 'bg-amber-500' : 'bg-zinc-400')} accessibilityLabel={live ? 'live' : 'offline'} />
        {demo && (
          <Pressable onPress={async () => { await exitDemo(); router.replace('/pair') }} className="flex-row items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5">
            <Text className="text-xs font-medium text-primary">Demo</Text><Icon as={X} size={12} tone="primary" />
          </Pressable>
        )}
      </View>
      <View className="flex-row items-center gap-0.5 rounded-lg bg-muted p-0.5">
        <Tab id="board" icon={LayoutGrid} label="Board" />
        <Tab id="inbox" icon={InboxIcon} label="Inbox" />
      </View>
      <Pressable onPress={showSearch} className="h-8 w-72 flex-row items-center gap-2 rounded-md border border-border bg-card px-2.5 web:hover:border-ring/40" accessibilityLabel={t('Suche')}>
        <Icon as={Search} size={15} tone="muted-foreground" />
        <Text className="flex-1 text-[13px] text-muted-foreground" numberOfLines={1}>{t('Suchen oder Befehl …')}</Text>
        <Text className="text-[11px] text-muted-foreground">⌘K</Text>
      </Pressable>
      <View {...drag} className="flex-1 self-stretch" />
      <Button variant="ghost" size="icon" onPress={() => router.push('/settings')} accessibilityLabel={t('Einstellungen')}><Icon as={Settings} size={18} /></Button>
      <Button size="sm" onPress={showNewChat}><Icon as={Plus} size={16} tone="primary-foreground" /><Text>{t('Neuer Chat')}</Text></Button>
    </View>
  )
}

function NewChatDialog() {
  return (
    <View className="w-[640px] max-w-full overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
      <View className="h-12 flex-row items-center border-b border-border pl-4 pr-2">
        <Text className="flex-1 text-[15px] font-semibold">{t('Neuer Chat')}</Text>
        <Button variant="ghost" size="icon" onPress={() => setOverlay(null)} accessibilityLabel={t('Schließen')}><Icon as={X} size={18} /></Button>
      </View>
      <Text className="px-4 pt-3 text-sm text-muted-foreground">{t('Hermes startet eine neue Session. Text, Bilder oder eine Sprachnachricht.')}</Text>
      <Composer
        autoFocus
        draftKey="new-chat"
        placeholder={t('Worum geht es?')}
        onSend={async (msg) => {
          const s = await createChat(msg).catch((e) => { toast(e instanceof Error ? e.message : String(e), 'error'); return null })
          if (s) showThread(s.id)
        }}
      />
    </View>
  )
}

function Overlay() {
  const overlay = useNav((n) => n.overlay)
  if (!overlay) return null
  return (
    <View className="absolute inset-0 z-40 items-center bg-black/30 pt-[12vh]">
      <Pressable className="absolute inset-0" onPress={() => setOverlay(null)} accessibilityRole="none" />
      {overlay === 'search' ? (
        <View className="w-[620px] max-w-[92%]">
          <SearchPanel
            palette
            onClose={() => setOverlay(null)}
            onPick={(id) => showThread(id)}
            onCommand={(id) => {
              setOverlay(null)
              if (id === 'new-chat') showNewChat()
              else if (id === 'board' || id === 'inbox') setTab(id)
              else if (id === 'settings') router.push('/settings')
            }}
          />
        </View>
      ) : <NewChatDialog />}
    </View>
  )
}

const SPLIT_KEY = 'hk_split'

/** The line between board and chat; drag it to resize (mounted with the pane, so the hook sees it). */
function SplitHandle({ onResize, onEnd }: { onResize: (dx: number) => void; onEnd: () => void }) {
  const ref = useRef<ComponentRef<typeof View>>(null)
  useSplitResize(ref, onResize, onEnd)
  return (
    <View ref={ref} className="w-[5px] items-center bg-transparent web:cursor-col-resize web:hover:bg-primary/20" accessibilityLabel={t('Breite ändern')}>
      <View className="h-full w-px bg-border" />
    </View>
  )
}

export function DesktopHome() {
  const sessions = useStore((s) => s.sessions)
  const tab = useStore((s) => s.tab)
  const openId = useStore((s) => s.openId)
  const pane = useNav((n) => n.pane)
  const overlay = useNav((n) => n.overlay)
  const { width } = useWindowDimensions()
  const { lists } = useMemo(() => groupSessions(sessions), [sessions])
  const [sel, setSel] = useState<{ col: number; idx: number } | null>(null)

  // Split view: thread width in px, remembered; the board keeps at least 520 px.
  const [split, setSplit] = useState(Math.round(width * 0.42))
  useEffect(() => { AsyncStorage.getItem(SPLIT_KEY).then((v) => v && setSplit(Number(v))) }, [])
  const threadWidth = Math.max(380, Math.min(split, width - 520))

  const selected = sel ? lists[COLUMNS[sel.col].id][sel.idx] : undefined
  const move = (col: number, idx: number) => {
    const list = lists[COLUMNS[col].id]
    setSel({ col, idx: Math.max(0, Math.min(idx, list.length - 1)) })
  }
  const act = (id: string) => {
    if (id === 'search') showSearch()
    else if (id === 'new-chat') showNewChat()
    else if (id === 'board' || id === 'inbox') setTab(id)
    else if (id === 'settings') router.push('/settings')
    else if (id === 'close') { if (overlay) setOverlay(null); else if (openId) closeThread() }
    else if (id.startsWith('column-')) { setTab('board'); move(Number(id.slice(7)) - 1, 0) }
  }
  useEffect(() => onShellAction(act), [overlay, openId, lists])

  // KEYS: ⌘K or / search · ⌘N or n new chat · ⌘B / ⌘I board / inbox · ⌘1–4 a column · ↑ ↓ ← → move
  // in the board · Enter open · Esc close the dialog, then the chat · ⌘, settings.
  useKeydown((e) => {
    if (e.meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setOverlay(overlay === 'search' ? null : 'search'); return }
    if (e.meta && e.key.toLowerCase() === 'n') { e.preventDefault(); act('new-chat'); return }
    if (e.meta && e.key === ',') { e.preventDefault(); act('settings'); return }
    if (e.meta && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); setTab(e.key === 'b' ? 'board' : 'inbox'); return }
    if (e.meta && /^[1-4]$/.test(e.key)) { e.preventDefault(); act(`column-${e.key}`); return }
    if (e.key === 'Escape') {
      if (overlay) { e.preventDefault(); setOverlay(null) } else if (openId && !e.typing) { e.preventDefault(); closeThread() } else if (sel && !e.typing) setSel(null)
      return
    }
    if (e.typing || overlay || e.meta) return
    if (e.key === '/') { e.preventDefault(); showSearch(); return }
    if (e.key === 'n') { e.preventDefault(); showNewChat(); return }
    if (tab !== 'board') return
    if (!sel && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'j', 'k'].includes(e.key)) { e.preventDefault(); move(Math.max(0, COLUMNS.findIndex((c) => lists[c.id].length)), 0); return }
    if (!sel) return
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(sel.col, sel.idx + 1) }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(sel.col, sel.idx - 1) }
    else if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); move(Math.min(3, sel.col + 1), sel.idx) }
    else if (e.key === 'ArrowLeft' || e.key === 'h') { e.preventDefault(); move(Math.max(0, sel.col - 1), sel.idx) }
    else if (e.key === 'Enter' && selected) { e.preventDefault(); showThread(selected.id) }
    else if (e.key === 'ContextMenu' && selected) { e.preventDefault(); cardMenu(selected, { x: width / 2, y: 200 }) }
  })

  return (
    <View className="flex-1 bg-background">
      <Header />
      <SyncBar />
      <OfflineBanner />
      <View className="flex-1 flex-row">
        <View className="min-w-0 flex-1">
          {tab === 'board' ? <BoardColumns lists={lists} visible={4} selection={sel} openId={openId} /> : <View className="mx-auto w-full max-w-[760px] flex-1"><Inbox /></View>}
        </View>
        {openId && (
          <>
            <SplitHandle onResize={(dx) => setSplit((w) => Math.max(380, Math.min(w, width - 520)) - dx)} onEnd={() => setSplit((w) => { AsyncStorage.setItem(SPLIT_KEY, String(Math.round(w))); return w })} />
            <View style={{ width: threadWidth }} className="min-w-0">
              {pane.kind === 'paseo'
                ? <PaseoPane key={`${openId}:${pane.agent ?? ''}`} id={openId} agent={pane.agent} embedded onBack={() => setPane({ kind: 'thread' })} />
                : <ThreadPane key={openId} sessionId={openId} embedded />}
            </View>
          </>
        )}
      </View>
      <Overlay />
      <MenuHost />
    </View>
  )
}
