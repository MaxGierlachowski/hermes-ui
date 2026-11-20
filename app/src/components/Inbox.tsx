// The inbox like the web UI's: "Needs you" (open approvals, questions, Paseo permissions, each in a card
// with its chat as header) and the history grouped by day in one card per day.
import { memo, useMemo, useState } from 'react'
import { RefreshControl, View, Pressable } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { showThread } from '@/lib/nav'
import { Bot, Check, CheckCheck, CircleCheck, CircleHelp, CircleX, MessageSquareShare, ShieldAlert, TriangleAlert, X, type LucideIcon } from 'lucide-react-native'
import type { InboxItem, OpenItem } from '@shared/types'
import { Button, BUTTON_ICON } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { PendingPrompt } from './PendingPrompt'
import { kindLabel, loadInbox, markRead, respondPaseo, useStore } from '@/lib/store'
import { lang, relTime, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { isWebDesktop as D } from '@/lib/web-input'

const REQUESTS = new Set(['approval', 'clarify', 'permission'])
type KindFilter = 'all' | 'requests' | 'done' | 'error'
type SourceFilter = 'all' | 'hermes' | 'paseo'
const matchesKind = (k: string, f: KindFilter) =>
  f === 'all' || (f === 'requests' ? REQUESTS.has(k) : f === 'done' ? k === 'done' || k === 'paseo-done' : k === 'error' || k === 'paseo-error' || k === 'paseo-limit')
// The filters survive switching tabs (module state, like the scroll position).
let lastKind: KindFilter = 'all'
let lastSource: SourceFilter = 'all'

/** A row of toggle buttons (the web UI's outline ToggleGroup). */
function Segmented<T extends string>({ value, options, onChange, grow }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; grow?: boolean }) {
  return (
    <View className={cn('flex-row rounded-lg border border-border', grow && 'flex-1')}>
      {options.map((o, i) => (
        <Pressable key={o.id} onPress={() => { haptic('select'); onChange(o.id) }} accessibilityRole="tab" accessibilityState={{ selected: value === o.id }}
          className={cn('items-center justify-center px-2.5 web:transition-colors', D ? 'h-7' : 'h-11 flex-1', i > 0 && 'border-l border-border', i === 0 && 'rounded-l-[7px]', i === options.length - 1 && 'rounded-r-[7px]', value === o.id ? 'bg-muted' : 'web:hover:bg-muted/50')}>
          <Text className={cn(D ? 'text-xs' : 'text-[13px]', value === o.id ? 'font-medium' : 'text-muted-foreground')}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}
const SIZE = D ? 'sm' : 'default'

function OpenHeader({ source, title, sub, at, sessionId }: { source: 'hermes' | 'paseo'; title: string; sub?: string | null; at: number; sessionId: string | null }) {
  return (
    <View className="mb-2 flex-row items-center gap-2">
      <View className={cn('h-5 w-5 items-center justify-center rounded-md', source === 'hermes' ? 'bg-primary' : 'border border-border bg-muted')}>
        {source === 'hermes' ? <Text className="text-[10px] font-bold text-primary-foreground">H</Text> : <Icon as={Bot} size={12} />}
      </View>
      <View className="min-w-0 flex-1">
        <Text className={cn('font-medium', D ? 'text-xs' : 'text-sm')} numberOfLines={1}>{title}</Text>
        {!!sub && <Text className={cn('text-muted-foreground', D ? 'text-xs' : 'text-[13px]')} numberOfLines={1}>{sub}</Text>}
      </View>
      <Text className="text-xs tabular-nums text-muted-foreground">{relTime(at)}</Text>
      {sessionId && (
        <Button variant="ghost" size={D ? 'sm' : 'icon-sm'} className={D ? 'h-7 px-2' : undefined} onPress={() => showThread(sessionId)} accessibilityLabel={t('Im Thread öffnen')}>
          <Icon as={MessageSquareShare} size={14} />{D && <Text className="text-xs">{t('Im Thread öffnen')}</Text>}
        </Button>
      )}
    </View>
  )
}

function PaseoPermission({ item }: { item: Extract<OpenItem, { source: 'paseo' }> }) {
  const [busy, setBusy] = useState(false)
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const p = item.permission
  const go = async (decision: 'allow' | 'deny') => {
    haptic()
    setBusy(true)
    const ok = await respondPaseo(item.agent.id, p.id, decision, decision === 'deny' ? reason.trim() || t('Abgelehnt in Hermes UI') : undefined)
    if (!ok) setBusy(false)
  }
  return (
    <View className="gap-2 rounded-lg border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/5 p-3">
      <View className="flex-row items-center gap-1.5">
        <Icon as={ShieldAlert} size={14} color="#d97706" />
        <Text className="flex-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300" numberOfLines={1}>{t('Paseo-Freigabe')}</Text>
        {!!p.name && <Text className="font-mono text-xs text-amber-700 dark:text-amber-300">{p.name}</Text>}
      </View>
      {!!p.title && <Text className={cn('font-medium', D ? 'text-sm' : 'text-[15px]')}>{p.title}</Text>}
      {!!p.description && <Text className={cn('text-foreground/90', D ? 'text-sm' : 'text-[15px]')}>{p.description}</Text>}
      {!!p.command && <Text selectable className="rounded-md border border-border bg-background/80 p-2 font-mono text-xs">{p.command}</Text>}
      {!!item.agent.cwd && <Text className="font-mono text-[11px] text-muted-foreground" numberOfLines={1}>{item.agent.cwd}</Text>}
      {!item.canRespond ? (
        <Text className="text-xs text-muted-foreground">{t('Antworten nur in Paseo möglich')}</Text>
      ) : denying ? (
        <View className="gap-2">
          <Input value={reason} onChangeText={setReason} placeholder={t('Begründung für den Agent (optional)')} autoFocus editable={!busy} onSubmitEditing={() => go('deny')} />
          <View className="flex-row gap-2">
            <Button size={SIZE} variant="destructive" disabled={busy} onPress={() => go('deny')}><Icon as={X} size={BUTTON_ICON - 2} tone="destructive" /><Text>{t('Ablehnen senden')}</Text></Button>
            <Button size={SIZE} variant="ghost" disabled={busy} onPress={() => setDenying(false)}><Text>{t('Abbrechen')}</Text></Button>
          </View>
        </View>
      ) : (
        // Same buttons as a Hermes approval: one row on the desktop, stacked touch targets on phones.
        <View className={D ? 'flex-row flex-wrap items-center gap-2 pt-1' : 'gap-3 pt-1'}>
          <Button size={SIZE} disabled={busy} onPress={() => go('allow')}><Icon as={Check} size={BUTTON_ICON - 2} tone="primary-foreground" /><Text>{t('Erlauben')}</Text></Button>
          <Button size={SIZE} variant="ghost" className={D ? 'ml-auto' : undefined} disabled={busy} onPress={() => setDenying(true)}>
            <Icon as={X} size={BUTTON_ICON - 2} tone="destructive" /><Text className="text-destructive">{t('Ablehnen')}</Text>
          </Button>
        </View>
      )}
    </View>
  )
}

function OpenCard({ item }: { item: OpenItem }) {
  return (
    <View className="rounded-xl border border-border/70 bg-card p-3">
      {item.source === 'hermes' ? (
        <>
          <OpenHeader source="hermes" title={item.title || 'Hermes'} sub="Hermes" at={item.at} sessionId={item.sessionId} />
          <PendingPrompt sessionId={item.sessionId} prompt={item.prompt} />
        </>
      ) : (
        <>
          <OpenHeader
            source="paseo"
            title={item.agent.title || item.agent.id.slice(0, 8)}
            sub={[`Paseo${item.agent.account ? ` · ${item.agent.account}` : ''}`, item.title ? t('aus „{chat}“', { chat: item.title }) : null].filter(Boolean).join(' · ')}
            at={item.at}
            sessionId={item.sessionId}
          />
          <PaseoPermission item={item} />
        </>
      )}
    </View>
  )
}

const ICON: Record<string, { icon: LucideIcon; color: string }> = {
  approval: { icon: ShieldAlert, color: '#d97706' },
  permission: { icon: ShieldAlert, color: '#d97706' },
  clarify: { icon: CircleHelp, color: '#d97706' },
  done: { icon: CircleCheck, color: '#059669' },
  'paseo-done': { icon: CircleCheck, color: '#059669' },
  error: { icon: CircleX, color: '#dc2626' },
  'paseo-error': { icon: CircleX, color: '#dc2626' },
  'paseo-limit': { icon: TriangleAlert, color: '#dc2626' },
}
const CHOICE: Record<string, string> = { once: 'einmal', session: 'für die Session', always: 'immer', deny: 'abgelehnt' }
function resolutionText(it: InboxItem) {
  const r = it.resolution
  if (!r) return REQUESTS.has(it.kind) ? t('offen') : null
  if (r.by === 'elsewhere') return t('anderswo beantwortet')
  if (r.by === 'expired') return t('abgelaufen')
  if (r.by === 'cancelled') return t('abgebrochen')
  const what = r.choice ? (r.choice === 'deny' ? t('Abgelehnt') : t('Erlaubt ({how})', { how: t(CHOICE[r.choice] || r.choice) }))
    : r.decision ? (r.decision === 'deny' ? t('Abgelehnt') : t('Erlaubt'))
      : t('Beantwortet{a}', { a: r.answer ? `: ${r.answer}` : '' })
  return `${what}${r.device ? ` · ${r.device}` : ''}`
}

// Formatters are created once: toLocale…String builds a new one on every call, per row.
const LOCALE = lang === 'de' ? 'de-DE' : 'en-GB'
const DAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: '2-digit', month: '2-digit' })
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' })

function dayLabel(ts: number) {
  const d = new Date(ts * 1000)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (diff === 0) return t('Heute')
  if (diff === 1) return t('Gestern')
  return DAY.format(d)
}

const HistoryRow = memo(function HistoryRow({ item, first, last }: { item: InboxItem; first: boolean; last: boolean }) {
  const { icon, color } = ICON[item.kind] || ICON.done
  const res = resolutionText(item)
  const title = item.source === 'paseo' ? item.agentTitle || item.title : item.title
  return (
    <Pressable
      onPress={() => { if (!item.read) markRead([item.id]); if (item.sessionId) showThread(item.sessionId) }}
      className={cn('flex-row items-start gap-3 border-x border-border/70 bg-card px-3 active:bg-muted/60 web:transition-colors web:hover:bg-muted/50', D ? 'py-2.5' : 'min-h-14 py-3',
        first ? 'rounded-t-xl border-t' : 'border-t border-t-border/60', last && 'rounded-b-xl border-b')}
    >
      <Icon as={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className={cn('shrink', D ? 'text-sm' : 'text-[15px]', item.read ? 'text-foreground/80' : 'font-medium')} numberOfLines={1}>{title || '—'}</Text>
          <Text className="text-[11px] text-muted-foreground">{item.source === 'paseo' ? 'Paseo' : 'Hermes'}</Text>
          <Text className="ml-auto text-[11px] tabular-nums text-muted-foreground">{TIME.format(item.at * 1000)}</Text>
          <View className={cn('h-1.5 w-1.5 rounded-full', item.read ? 'bg-transparent' : 'bg-primary')} />
        </View>
        <Text className={cn('mt-0.5 text-muted-foreground', D ? 'text-xs' : 'text-[13px]')} numberOfLines={1}>
          <Text className="text-foreground/70">{kindLabel(item.kind)}</Text>
          {item.source === 'paseo' && item.title && item.agentTitle && item.title !== item.agentTitle ? ` · ${t('aus „{chat}“', { chat: item.title })}` : ''}
          {res ? ` · ${res}` : ''}
        </Text>
        {!!item.text && <Text className={cn('mt-0.5 text-muted-foreground/90', D ? 'text-xs' : 'text-[13px]')} numberOfLines={2}>{item.text}</Text>}
      </View>
    </Pressable>
  )
})

type Row = { kind: 'day'; label: string } | { kind: 'item'; item: InboxItem; first: boolean; last: boolean }

function SectionTitle({ label, count, dot }: { label: string; count?: string | number; dot?: string }) {
  return (
    <View className="mb-2 flex-row items-center gap-2">
      {!!dot && <View className={cn('h-2 w-2 rounded-full', dot)} />}
      <Text className={cn('font-medium text-foreground/90', D ? 'text-[12.5px]' : 'text-sm')}>{label}</Text>
      {count !== undefined && <Text className={cn('font-medium tabular-nums text-muted-foreground', D ? 'text-[12.5px]' : 'text-sm')}>{count}</Text>}
    </View>
  )
}

export function Inbox() {
  const inbox = useStore((s) => s.inbox)
  const [refreshing, setRefreshing] = useState(false)
  const [kind, setKindState] = useState<KindFilter>(lastKind)
  const [source, setSourceState] = useState<SourceFilter>(lastSource)
  const setKind = (k: KindFilter) => { lastKind = k; setKindState(k) }
  const setSource = (k: SourceFilter) => { lastSource = k; setSourceState(k) }
  const open = inbox.open.filter((o) => (source === 'all' || o.source === source) && (kind === 'all' || kind === 'requests'))
  const rows = useMemo(() => {
    const out: Row[] = []
    let day = ''
    const items = inbox.items.filter((it) => (source === 'all' || it.source === source) && matchesKind(it.kind, kind)
      && !(REQUESTS.has(it.kind) && !it.resolution && inbox.open.some((o) => o.key === it.id)))
    const labels = items.map((it) => dayLabel(it.at))
    items.forEach((item, i) => {
      const label = labels[i]
      const first = label !== day
      if (first) { out.push({ kind: 'day', label }); day = label }
      out.push({ kind: 'item', item, first, last: labels[i + 1] !== label })
    })
    return out
  }, [inbox.items, inbox.open, kind, source])
  const toolbar = (
    <View className={cn('flex-row items-center gap-2 border-b border-border', D ? 'flex-wrap px-4 py-2' : 'px-3 py-2')}>
      <Segmented value={kind} onChange={setKind} grow={!D} options={[{ id: 'all', label: t('Alle') }, { id: 'requests', label: t('Freigaben') }, { id: 'done', label: t('Fertig') }, { id: 'error', label: t('Fehler') }]} />
      {/* Phones: one row (kinds + "mark all read"); the source filter only where there is room. */}
      {D && <Segmented value={source} onChange={setSource} options={[{ id: 'all', label: t('Alle Quellen') }, { id: 'hermes', label: 'Hermes' }, { id: 'paseo', label: 'Paseo' }]} />}
      {D
        ? <Button variant="ghost" size="sm" className="ml-auto" disabled={!inbox.unread} onPress={() => markRead('all')}><Icon as={CheckCheck} size={14} /><Text className="text-xs">{t('Alle gelesen')}</Text></Button>
        : <Button variant="ghost" size="icon-sm" disabled={!inbox.unread} onPress={() => markRead('all')} accessibilityLabel={t('Alle gelesen')}><Icon as={CheckCheck} size={18} /></Button>}
    </View>
  )
  return (
    <View className="flex-1">
    {toolbar}
    <FlashList
      data={rows}
      keyExtractor={(r) => (r.kind === 'day' ? `d:${r.label}` : r.item.id)}
      getItemType={(r) => r.kind}
      contentContainerStyle={{ paddingHorizontal: D ? 16 : 12, paddingTop: 16, paddingBottom: 128 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadInbox(); setRefreshing(false) }} />}
      ListHeaderComponent={
        <View className="gap-6 pb-1">
          <View>
            <SectionTitle label={t('Braucht dich')} count={open.length} dot={open.length ? 'bg-amber-500' : 'bg-zinc-400 dark:bg-zinc-500'} />
            {open.length ? (
              <View className="gap-3">{open.map((o) => <OpenCard key={o.key} item={o} />)}</View>
            ) : (
              <View className="rounded-lg border border-dashed border-border px-3 py-6"><Text className="text-center text-xs text-muted-foreground">{t('Nichts offen – keine Freigaben oder Rückfragen.')}</Text></View>
            )}
          </View>
          <SectionTitle label={t('Verlauf')} count={inbox.unread > 0 ? t('{n} ungelesen', { n: inbox.unread }) : undefined} />
          {!rows.length && <Text className="-mt-4 py-6 text-center text-xs text-muted-foreground">{inbox.loaded ? t('Noch keine Benachrichtigungen.') : '…'}</Text>}
        </View>
      }
      renderItem={({ item: r }) => r.kind === 'day'
        ? <Text className="mb-1.5 mt-3 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{r.label}</Text>
        : <HistoryRow item={r.item} first={r.first} last={r.last} />}
    />
    </View>
  )
}
