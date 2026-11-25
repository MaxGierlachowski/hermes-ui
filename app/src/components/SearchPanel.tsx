// Full-text search over titles and message content (backend /api/search, Hermes' FTS index), plus
// a few commands while the field is empty. A screen on the phone (app/search.tsx), the ⌘K palette on
// the desktop (palette): ↑ ↓ move, Enter opens, Esc closes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Bot, Inbox, LayoutGrid, MessagesSquare, Plus, Search as SearchIcon, Settings, type LucideIcon } from 'lucide-react-native'
import { COLUMNS } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { COLUMN_COLOR, StatusDot, sourceIcon } from '@/components/status'
import { Kbd } from '@/components/ui/kbd'
import { searchChats, useStore, type SearchHit } from '@/lib/store'
import { relTime, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { shadow } from '@/lib/shadow'

export type Command = { id: string; label: string; icon: LucideIcon; hint?: string }
export const PALETTE_COMMANDS: Command[] = [
  { id: 'new-chat', label: 'Neuer Chat', icon: Plus, hint: '⌘N' },
  { id: 'board', label: 'Board', icon: LayoutGrid, hint: '⌘B' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, hint: '⌘I' },
  { id: 'settings', label: 'Einstellungen', icon: Settings, hint: '⌘,' },
]

type Item = { kind: 'hit'; hit: SearchHit } | { kind: 'cmd'; cmd: Command } | { kind: 'group'; label: string }

const MARK = 'rounded-sm bg-amber-300/50 text-foreground dark:bg-amber-400/30'
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Backend snippets mark hits with \u0002 … \u0003; titles get the query words marked here. */
function Marked({ text, query }: { text: string; query?: string }) {
  if (!query) {
    // oxlint-disable-next-line no-control-regex -- the markers are control characters on purpose
    const parts = text.replace(/\s+/g, ' ').split(/(\u0002[^\u0003]*\u0003)/)
    return <>{parts.map((p, i) => (p.startsWith('\u0002') ? <Text key={i} className={MARK}>{p.slice(1, -1)}</Text> : p))}</>
  }
  const words = query.split(/\s+/).filter(Boolean).map(escape)
  if (!words.length) return <>{text}</>
  return <>{text.split(new RegExp(`(${words.join('|')})`, 'gi')).map((p, i) => (i % 2 ? <Text key={i} className={MARK}>{p}</Text> : p))}</>
}

function HitRow({ hit: { session: s, hit }, query, selected, palette }: { hit: SearchHit; query: string; selected: boolean; palette: boolean }) {
  const col = COLUMNS.find((c) => c.id === s.column)
  const agents = s.paseo?.length || 0
  const SourceIcon = sourceIcon(s.source)
  return (
    <View className={cn('flex-row items-start gap-3', palette ? 'rounded-lg px-2.5 py-2' : 'border-b border-border py-3', palette && selected && 'bg-muted')}>
      <StatusDot column={s.column} running={s.running} pending={!!s.pending?.length} className="mt-1.5" />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline gap-2">
          <Text className={cn('flex-1 font-medium', palette ? 'text-sm' : 'text-[15px]')} numberOfLines={1}><Marked text={s.title || t('Ohne Titel')} query={query} /></Text>
          <Text className="text-[11px] tabular-nums text-muted-foreground">{relTime(s.updatedAt)}</Text>
        </View>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2">
          <View className="flex-row items-center gap-1"><Icon as={SourceIcon} size={12} tone="muted-foreground" /><Text className="text-[11px] text-muted-foreground">{s.source}</Text></View>
          {col && <View className="flex-row items-center gap-1"><View className={cn('h-1.5 w-1.5 rounded-full', COLUMN_COLOR[s.column])} /><Text className="text-[11px] text-muted-foreground">{col.label}</Text></View>}
          {s.messageCount > 0 && <View className="flex-row items-center gap-1"><Icon as={MessagesSquare} size={12} tone="muted-foreground" /><Text className="text-[11px] text-muted-foreground">{s.messageCount}</Text></View>}
          {agents > 0 && <View className="flex-row items-center gap-1"><Icon as={Bot} size={12} tone="muted-foreground" /><Text className="text-[11px] text-muted-foreground">{agents}</Text></View>}
          {!!hit && hit.hits > 1 && <Text className="text-[11px] text-muted-foreground">{t('{n} Treffer', { n: hit.hits })}</Text>}
        </View>
        {!!hit?.snippet && (
          <Text className={cn('mt-1 text-muted-foreground', palette ? 'text-xs leading-5' : 'text-[13px]')} numberOfLines={2}>
            <Text className="font-medium text-foreground/70">{hit.role === 'user' ? t('Du') : hit.role === 'event' ? t('Event') : 'Hermes'}: </Text>
            <Marked text={hit.snippet} />
          </Text>
        )}
      </View>
    </View>
  )
}

export function SearchPanel({ palette = false, onClose, onPick, onCommand }: { palette?: boolean; onClose: () => void; onPick: (id: string) => void; onCommand?: (id: string) => void }) {
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<(SearchHit & { group: 'title' | 'content' })[]>([])
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    const query = q.trim()
    setSel(0)
    if (query.length < 2) { setHits([]); return }
    const n = ++seq.current
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await searchChats(query)
        if (n !== seq.current) return
        const seen = new Set<string>()
        // Content hits whose title also matched are shown once, under "Title", with their snippet.
        const content = new Map(r.content.map((h) => [h.session.id, h]))
        const title = r.title.map((h) => ({ ...h, hit: h.hit ?? content.get(h.session.id)?.hit, group: 'title' as const }))
        title.forEach((h) => seen.add(h.session.id))
        setHits([...title, ...r.content.filter((h) => !seen.has(h.session.id) && seen.add(h.session.id)).map((h) => ({ ...h, group: 'content' as const }))])
      } catch { /* shown as empty */ } finally { if (n === seq.current) setBusy(false) }
    }, palette ? 120 : 250)
    return () => clearTimeout(timer)
  }, [q])

  const sessions = useStore((st) => st.sessions)
  const recent = useMemo(() => (palette ? Object.values(sessions).filter((x) => !x.system).sort((x, y) => y.updatedAt - x.updatedAt).slice(0, 5) : []), [sessions, palette])
  const groups: Item[] = []
  if (palette && q.trim().length < 2) {
    // Empty palette like the web UI: the most recently active chats, then the actions.
    if (!q.trim() && recent.length) groups.push({ kind: 'group', label: t('Zuletzt aktiv') }, ...recent.map((session) => ({ kind: 'hit' as const, hit: { session } })))
    const cmds = PALETTE_COMMANDS.filter((c) => !q.trim() || t(c.label).toLowerCase().includes(q.trim().toLowerCase()))
    if (cmds.length) groups.push({ kind: 'group', label: t('Aktionen') }, ...cmds.map((cmd) => ({ kind: 'cmd' as const, cmd })))
  } else {
    for (const g of ['title', 'content'] as const) {
      const list = hits.filter((h) => h.group === g)
      if (list.length) groups.push(...(palette ? [{ kind: 'group' as const, label: t(g === 'title' ? 'Titel' : 'Inhalt') }] : []), ...list.map((hit) => ({ kind: 'hit' as const, hit })))
    }
  }
  const items = groups
  // Keyboard selection skips the group labels.
  const selectable = items.map((it, i) => (it.kind === 'group' ? -1 : i)).filter((i) => i >= 0)
  const selIndex = selectable[Math.min(sel, selectable.length - 1)] ?? -1
  const choose = (it: Item | undefined) => {
    if (!it || it.kind === 'group') return
    if (it.kind === 'hit') onPick(it.hit.session.id)
    else onCommand?.(it.cmd.id)
  }
  const list = useRef<FlatList<Item>>(null)
  // Only keyboard moves scroll the list. Hover selects too, and scrolling on hover would move the
  // next row under a resting mouse, select it, scroll again: the list drifts on its own.
  const byKey = useRef(false)
  const hover = (index: number) => { byKey.current = false; setSel(selectable.indexOf(index)) }
  const onKey = (key: string, e: { preventDefault(): void }) => {
    if (key === 'ArrowDown') { e.preventDefault(); byKey.current = true; setSel((i) => Math.min(selectable.length - 1, i + 1)) }
    else if (key === 'ArrowUp') { e.preventDefault(); byKey.current = true; setSel((i) => Math.max(0, i - 1)) }
    else if (key === 'Enter') { e.preventDefault(); choose(items[selIndex]) }
    else if (key === 'Escape') { e.preventDefault(); onClose() }
  }
  useEffect(() => {
    if (!byKey.current) return
    byKey.current = false
    if (palette && selIndex >= 0) list.current?.scrollToIndex({ index: selIndex, viewPosition: 0.5, animated: false })
  }, [sel])

  return (
    // Palette: the web UI's command dialog (popover surface, hairline ring, search field on top, key hints below).
    <View className={cn(palette ? 'max-h-[480px] overflow-hidden rounded-xl border border-foreground/10 bg-popover' : 'flex-1 bg-background')} style={palette ? shadow('lg') : undefined}>
      <View className={cn('flex-row items-center gap-1 border-b border-border px-1 pb-2', palette && 'm-1 mb-0 h-8 gap-2 rounded-lg border-0 bg-input/30 px-2 pb-0')} style={palette ? undefined : { paddingTop: insets.top + 4 }}>
        {palette ? <Icon as={SearchIcon} size={16} tone="muted-foreground" style={{ opacity: 0.7 }} /> : <Button variant="ghost" size="icon" onPress={onClose} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>}
        <Input
          className={cn('mr-2 flex-1', palette && 'mr-0 min-h-8 border-0 bg-transparent px-0 dark:bg-transparent')}
          {...(palette ? ({ dataSet: { hkField: undefined } } as object) : {})}
          value={q}
          onChangeText={setQ}
          placeholder={t('Chats, Inhalte oder Befehle suchen …')}
          autoFocus
          returnKeyType="search"
          onKeyPress={palette ? (e) => onKey((e.nativeEvent as { key: string }).key, e) : undefined}
        />
      </View>
      {busy && <ActivityIndicator className="mt-4" />}
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(it) => (it.kind === 'hit' ? it.hit.session.id : it.kind === 'cmd' ? it.cmd.id : `g:${it.label}`)}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={palette ? 'p-1' : 'px-4 pb-10'}
        onScrollToIndexFailed={() => {}}
        ListEmptyComponent={q.trim().length >= 2 && !busy ? <Text className="py-10 text-center text-muted-foreground">{t('Nichts gefunden für „{q}“.', { q: q.trim() })}</Text> : undefined}
        renderItem={({ item: it, index }) => it.kind === 'group' ? (
          <Text className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{it.label}</Text>
        ) : it.kind === 'cmd' ? (
          <Pressable onPress={() => choose(it)} onHoverIn={() => hover(index)} className={cn('flex-row items-center gap-2 rounded-lg px-2', palette ? 'h-8' : 'h-12', index === selIndex && 'bg-muted')}>
            <Icon as={it.cmd.icon} size={16} tone="muted-foreground" />
            <Text className="flex-1 text-sm">{t(it.cmd.label)}</Text>
            {!!it.cmd.hint && <Text className="text-xs tracking-widest text-muted-foreground">{it.cmd.hint}</Text>}
          </Pressable>
        ) : (
          <Pressable onPress={() => choose(it)} onHoverIn={palette ? () => hover(index) : undefined} className="active:bg-accent">
            <HitRow hit={it.hit} query={q.trim()} selected={index === selIndex} palette={palette} />
          </Pressable>
        )}
      />
      {palette && (
        <View className="h-9 flex-row items-center justify-end gap-3 border-t border-border px-3">
          <View className="flex-row items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd><Text className="text-[11px] text-muted-foreground">{t('wählen')}</Text></View>
          <View className="flex-row items-center gap-1"><Kbd>↵</Kbd><Text className="text-[11px] text-muted-foreground">{t('öffnen')}</Text></View>
          <View className="flex-row items-center gap-1"><Kbd>esc</Kbd><Text className="text-[11px] text-muted-foreground">{t('schließen')}</Text></View>
        </View>
      )}
    </View>
  )
}
