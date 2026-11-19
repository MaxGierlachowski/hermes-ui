// Full-text search over titles and message content (backend /api/search, Hermes' FTS index), plus
// a few commands while the field is empty. A screen on the phone (app/search.tsx), the ⌘K palette on
// the desktop (palette): ↑ ↓ move, Enter opens, Esc closes.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Inbox, LayoutGrid, Plus, Search as SearchIcon, Settings, type LucideIcon } from 'lucide-react-native'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { StatusDot } from '@/components/status'
import { searchChats, type SearchHit } from '@/lib/store'
import { relTime, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type Command = { id: string; label: string; icon: LucideIcon; hint?: string }
export const PALETTE_COMMANDS: Command[] = [
  { id: 'new-chat', label: 'Neuer Chat', icon: Plus, hint: '⌘N' },
  { id: 'board', label: 'Board', icon: LayoutGrid, hint: '⌘B' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, hint: '⌘I' },
  { id: 'settings', label: 'Einstellungen', icon: Settings, hint: '⌘,' },
]

type Item = { kind: 'hit'; hit: SearchHit } | { kind: 'cmd'; cmd: Command }

export function SearchPanel({ palette = false, onClose, onPick, onCommand }: { palette?: boolean; onClose: () => void; onPick: (id: string) => void; onCommand?: (id: string) => void }) {
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
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
        setHits([...r.title, ...r.content].filter((h) => !seen.has(h.session.id) && seen.add(h.session.id)))
      } catch { /* shown as empty */ } finally { if (n === seq.current) setBusy(false) }
    }, palette ? 120 : 250)
    return () => clearTimeout(timer)
  }, [q])

  const items: Item[] = palette && q.trim().length < 2
    ? PALETTE_COMMANDS.filter((c) => !q.trim() || t(c.label).toLowerCase().includes(q.trim().toLowerCase())).map((cmd) => ({ kind: 'cmd' as const, cmd }))
    : hits.map((hit) => ({ kind: 'hit' as const, hit }))
  const choose = (it: Item | undefined) => {
    if (!it) return
    if (it.kind === 'hit') onPick(it.hit.session.id)
    else onCommand?.(it.cmd.id)
  }
  const list = useRef<FlatList<Item>>(null)
  const onKey = (key: string, e: { preventDefault(): void }) => {
    if (key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(items.length - 1, i + 1)) }
    else if (key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
    else if (key === 'Enter') { e.preventDefault(); choose(items[sel]) }
    else if (key === 'Escape') { e.preventDefault(); onClose() }
  }
  useEffect(() => { if (palette && items.length) list.current?.scrollToIndex({ index: Math.min(sel, items.length - 1), viewPosition: 0.5, animated: false }) }, [sel])

  return (
    <View className={cn('bg-background', palette ? 'max-h-[460px] overflow-hidden rounded-xl border border-border shadow-2xl' : 'flex-1')}>
      <View className={cn('flex-row items-center gap-1 border-b border-border px-1 pb-2', palette && 'h-12 px-3 pb-0')} style={palette ? undefined : { paddingTop: insets.top + 4 }}>
        {palette ? <Icon as={SearchIcon} size={18} tone="muted-foreground" /> : <Button variant="ghost" size="icon" onPress={onClose} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>}
        <Input
          className={cn('mr-2 flex-1', palette && 'border-0 bg-transparent web:focus:ring-0')}
          value={q}
          onChangeText={setQ}
          placeholder={t('Chats, Inhalte oder Befehle suchen …')}
          autoFocus
          returnKeyType="search"
          onKeyPress={palette ? (e) => onKey((e.nativeEvent as { key: string }).key, e) : undefined}
        />
        {palette && <Text className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">Esc</Text>}
      </View>
      {busy && <ActivityIndicator className="mt-4" />}
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(it) => (it.kind === 'hit' ? it.hit.session.id : it.cmd.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={palette ? 'p-1.5' : 'px-4 pb-10'}
        onScrollToIndexFailed={() => {}}
        ListEmptyComponent={q.trim().length >= 2 && !busy ? <Text className="py-10 text-center text-muted-foreground">{t('Nichts gefunden für „{q}“.', { q: q.trim() })}</Text> : undefined}
        renderItem={({ item: it, index }) => it.kind === 'cmd' ? (
          <Pressable onPress={() => choose(it)} onHoverIn={() => setSel(index)} className={cn('h-10 flex-row items-center gap-3 rounded-lg px-3', index === sel && 'bg-accent')}>
            <Icon as={it.cmd.icon} size={16} tone="muted-foreground" />
            <Text className="flex-1 text-sm">{t(it.cmd.label)}</Text>
            {!!it.cmd.hint && <Text className="text-xs text-muted-foreground">{it.cmd.hint}</Text>}
          </Pressable>
        ) : (
          <Pressable onPress={() => choose(it)} onHoverIn={palette ? () => setSel(index) : undefined} className={cn('min-h-14 gap-1 py-3 active:bg-accent', palette ? 'rounded-lg px-3' : 'border-b border-border', palette && index === sel && 'bg-accent')}>
            <View className="flex-row items-center gap-2">
              <StatusDot column={it.hit.session.column} />
              <Text className="flex-1 text-[15px] font-medium" numberOfLines={1}>{it.hit.session.title || t('Ohne Titel')}</Text>
              <Text className="text-xs text-muted-foreground">{relTime(it.hit.session.updatedAt)}</Text>
            </View>
            {it.hit.hit && <Text className="text-[13px] text-muted-foreground" numberOfLines={2}>{it.hit.hit.snippet.replace(/[\u0002\u0003]/g, '')}</Text>}
          </Pressable>
        )}
      />
    </View>
  )
}
