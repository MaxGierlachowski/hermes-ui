// The inbox like the web UI's: "Needs you" (open approvals, questions, Paseo permissions, each in a card
// with its chat as header) and the history grouped by day in one card per day. Automation entries (cron
// runs, webhook runs, POST /api/notify) are folded into one row per job, route or notify group.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshControl, View, Pressable } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { showThread } from '@/lib/nav'
import { Bot, Check, CheckCheck, ChevronRight, CircleCheck, CircleHelp, CircleX, Clock, ExternalLink, MessageSquareShare, ShieldAlert, SquareTerminal, TriangleAlert, Webhook, X, type LucideIcon } from 'lucide-react-native'
import type { InboxItem, InboxSource, OpenItem } from '@shared/types'
import { groupKey, historyEntries, isAutomation, isFailure, isRequest, matchesKind, matchesSource, sourceFilterFrom, type InboxGroup, type InboxKindFilter, type InboxSourceFilter } from '@shared/inbox-groups'
import { Button, BUTTON_ICON } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { Markdown } from './Markdown'
import { PendingPrompt } from './PendingPrompt'
import { focusInboxItem, kindLabel, loadInbox, markRead, respondPaseo, sourceLabel, useStore } from '@/lib/store'
import { openExternal } from '@/lib/desktop'
import { lang, relTime, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { isWebDesktop as D } from '@/lib/web-input'

/** A row of toggle buttons (the web UI's outline ToggleGroup). */
function Segmented<T extends string>({ value, options, onChange, grow, fit }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; grow?: boolean; fit?: boolean }) {
  // fit: segments as wide as their label plus an equal share of the rest (long labels on a phone).
  return (
    <View className={cn('flex-row rounded-lg border border-border', grow && 'flex-1')}>
      {options.map((o, i) => (
        <Pressable key={o.id} onPress={() => { haptic('select'); onChange(o.id) }} accessibilityRole="tab" accessibilityState={{ selected: value === o.id }}
          className={cn('items-center justify-center px-2.5 web:transition-colors', D ? 'h-7' : fit ? 'h-11 grow' : 'h-11 flex-1', i > 0 && 'border-l border-border', i === 0 && 'rounded-l-[7px]', i === options.length - 1 && 'rounded-r-[7px]', value === o.id ? 'bg-muted' : 'web:hover:bg-muted/50')}>
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
  if (!r) return isRequest(it) ? t('offen') : null
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

const HistoryRow = memo(function HistoryRow({ item, first, last, flash }: { item: InboxItem; first: boolean; last: boolean; flash: boolean }) {
  const { icon, color } = ICON[item.kind] || ICON.done
  const res = resolutionText(item)
  const title = item.source === 'paseo' ? item.agentTitle || item.title : item.title
  return (
    <Pressable
      onPress={() => { if (!item.read) markRead([item.id]); if (item.sessionId) showThread(item.sessionId) }}
      className={cn('flex-row items-start gap-3 bg-card px-3 active:bg-muted/60 web:hover:bg-muted/50', CARD_ROW, D ? 'py-2.5' : 'min-h-14 py-3', cardEdges(first, last), flash && 'bg-primary/5')}
    >
      <Icon as={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className={cn('shrink', D ? 'text-sm' : 'text-[15px]', item.read ? 'text-foreground/80' : 'font-medium')} numberOfLines={1}>{title || '—'}</Text>
          <Text className="text-[11px] text-muted-foreground">{sourceLabel(item.source)}</Text>
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

// ---------- automations (cron runs, webhook runs, POST /api/notify) ----------
// One row per job, route or notify group (shared/inbox-groups.ts); expanded, its entries follow as rows
// of their own (newest first), each one expands into its report (Markdown), link and chat.
const SOURCE_ICON: Partial<Record<InboxSource, LucideIcon>> = { cron: Clock, webhook: Webhook, notify: SquareTerminal }
type Status = 'ok' | 'warn' | 'error'
const statusOf = (it: InboxItem): Status => (isFailure(it) ? 'error' : it.level === 'warn' ? 'warn' : 'ok')
const STATUS: Record<Status, { icon: LucideIcon; color: string; text: string; label: string }> = {
  ok: { icon: CircleCheck, color: '#059669', text: 'text-emerald-600 dark:text-emerald-400', label: 'OK' },
  warn: { icon: TriangleAlert, color: '#d97706', text: 'text-amber-600 dark:text-amber-400', label: 'Warnung' },
  error: { icon: CircleX, color: '#dc2626', text: 'text-red-600 dark:text-red-400', label: 'Fehler' },
}
/** Entries shown in an expanded group before "show older". */
const GROUP_PAGE = 10
// Icons in a row of text: an svg shrinks with the row otherwise (react-native-web).
const NO_SHRINK = { flexShrink: 0 } as const

/** Time of day, with the date for an entry of an earlier day (a group's entries can span days). */
const STAMP = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
function stamp(ts: number) {
  const d = new Date(ts * 1000)
  return d.toDateString() === new Date().toDateString() ? TIME.format(d) : STAMP.format(d)
}
/** host/path of a link, without the scheme. */
function linkLabel(url: string) {
  try { const u = new URL(url); return `${u.host}${u.pathname === '/' ? '' : u.pathname}` } catch { return url }
}

const GroupRow = memo(function GroupRow({ group, open, first, last, onToggle }: { group: InboxGroup; open: boolean; first: boolean; last: boolean; onToggle: (key: string) => void }) {
  const newest = group.items[0]
  const st = STATUS[group.status === 'error' ? 'error' : statusOf(newest)]
  const failed = group.status === 'error'
  return (
    <Pressable
      onPress={() => { haptic('select'); onToggle(group.key) }}
      accessibilityRole="button" accessibilityState={{ expanded: open }} testID="automation-group"
      className={cn('flex-row items-start gap-3 bg-card px-3 active:bg-muted/60 web:hover:bg-muted/50', CARD_ROW, D ? 'py-2.5' : 'min-h-14 py-3', cardEdges(first, last && !open))}
    >
      <Icon as={SOURCE_ICON[group.source] || SquareTerminal} size={16} color={failed ? st.color : undefined} tone="muted-foreground" style={{ marginTop: 2, flexShrink: 0 }} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className={cn('shrink', D ? 'text-sm' : 'text-[15px]', group.unread ? 'font-medium' : 'text-foreground/80')} numberOfLines={1}>{group.name}</Text>
          <Text className="text-[11px] text-muted-foreground">{sourceLabel(group.source)}</Text>
          <Text className="ml-auto text-[11px] tabular-nums text-muted-foreground">{TIME.format(group.at * 1000)}</Text>
          {group.unread > 0
            ? <View className="h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1" accessibilityLabel={t('{n} ungelesen', { n: group.unread })}>
                <Text className="text-[10.5px] font-medium leading-4 tabular-nums text-primary-foreground">{group.unread}</Text>
              </View>
            : <View className="w-1.5" />}
        </View>
        <View className="mt-0.5 flex-row items-center gap-1">
          <Icon as={st.icon} size={12} color={st.color} style={NO_SHRINK} />
          <Text className={cn(D ? 'text-xs' : 'text-[13px]', failed ? st.text : 'text-foreground/70')}>{t(st.label)}</Text>
          {!!newest.title && <Text className={cn('min-w-0 shrink text-muted-foreground', D ? 'text-xs' : 'text-[13px]')} numberOfLines={1}>· {newest.title}</Text>}
          {group.items.length > 1 && <Text className={cn('ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground', D ? 'text-xs' : 'text-[13px]')} numberOfLines={1}>{t('{n} Einträge', { n: group.items.length })}</Text>}
        </View>
      </View>
      <Icon as={ChevronRight} size={16} tone="muted-foreground" style={{ marginTop: 2, transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
    </Pressable>
  )
})

const EntryRow = memo(function EntryRow({ item, open, last, flash, onToggle }: { item: InboxItem; open: boolean; last: boolean; flash: boolean; onToggle: (item: InboxItem) => void }) {
  const st = STATUS[statusOf(item)]
  const repeat = item.repeat ?? 0
  return (
    <View className={cn('overflow-hidden bg-card', CARD_ROW, cardEdges(false, last), 'border-t-border/40')} testID={`inbox-entry-${item.id}`}>
      <View className={cn('bg-muted/30', flash && 'bg-primary/5')}>
        <Pressable
          onPress={() => onToggle(item)} accessibilityRole="button" accessibilityState={{ expanded: open }} testID="automation-entry"
          className={cn('flex-row items-start gap-2.5 pr-3 web:transition-colors web:hover:bg-muted/50 active:bg-muted/60', D ? 'py-2 pl-10' : 'min-h-12 py-2.5 pl-8')}
        >
          <Icon as={st.icon} size={14} color={st.color} style={{ marginTop: D ? 2 : 3, flexShrink: 0 }} />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <Text className={cn('shrink', D ? 'text-[13px]' : 'text-sm', item.read ? 'text-foreground/80' : 'font-medium')} numberOfLines={open ? 3 : 1}>{item.title || '—'}</Text>
              {repeat > 1 && (
                <View className="rounded border border-border/60 bg-muted px-1" accessibilityLabel={t('{n}× derselbe Fehler', { n: repeat })}>
                  <Text className="text-[11px] tabular-nums text-muted-foreground">×{repeat}</Text>
                </View>
              )}
              <Text className="ml-auto text-[11px] tabular-nums text-muted-foreground">{stamp(item.at)}</Text>
              <View className={cn('h-1.5 w-1.5 rounded-full', item.read ? 'bg-transparent' : 'bg-primary')} />
            </View>
            {!open && (
              <Text className={cn('mt-0.5 text-muted-foreground/90', D ? 'text-xs' : 'text-[13px]')} numberOfLines={1}>
                <Text className={statusOf(item) === 'ok' ? 'text-foreground/70' : st.text}>{t(st.label)}</Text>
                {repeat > 1 ? ` · ${t('{n}× derselbe Fehler', { n: repeat })}` : ''}
                {` · ${relTime(item.at)}`}
                {item.text ? ` · ${item.text}` : ''}
              </Text>
            )}
          </View>
          <Icon as={ChevronRight} size={14} tone="muted-foreground" style={{ marginTop: 3, transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
        </Pressable>
        {open && (
          // A sibling of the header, not inside it: the report's text can be selected and its links tapped.
          <View className={cn('gap-2.5 pb-3 pr-3', D ? 'pl-16' : 'pl-8')} testID="automation-body">
            <Text className="text-xs text-muted-foreground">
              <Text className={statusOf(item) === 'ok' ? 'text-foreground/70' : st.text}>{t(st.label)}</Text>
              {repeat > 1 ? ` · ${t('{n}× derselbe Fehler', { n: repeat })}` : ''}
              {` · ${relTime(item.at)}`}
            </Text>
            {item.body || item.text
              ? <View className="hk-thread rounded-lg border border-border/70 bg-background px-3 py-1"><Markdown text={item.body || item.text} /></View>
              : <Text className="text-xs text-muted-foreground">{t('Kein Bericht.')}</Text>}
            {(!!item.sessionId || !!item.link) && (
              <View className="flex-row flex-wrap items-center gap-2">
                {!!item.sessionId && (
                  <Button size="sm" variant="outline" className={D ? 'h-7 px-2.5' : undefined} onPress={() => { if (!item.read) markRead([item.id]); showThread(item.sessionId!) }}>
                    <Icon as={MessageSquareShare} size={14} /><Text className="text-xs">{t('Zum Chat')}</Text>
                  </Button>
                )}
                {!!item.link && (
                  <Button size="sm" variant="ghost" className={cn('min-w-0 shrink', D && 'h-7 px-2')} onPress={() => openExternal(item.link!)} accessibilityRole="link">
                    <Icon as={ExternalLink} size={14} /><Text className="shrink text-xs" numberOfLines={1}>{linkLabel(item.link)}</Text>
                  </Button>
                )}
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  )
})

/** Rows of the day cards: the open side of a card is drawn by its first and last row. */
const CARD_ROW = 'border-x border-border/70 web:transition-colors'
const cardEdges = (first: boolean, last: boolean) => cn(first ? 'rounded-t-xl border-t' : 'border-t border-t-border/60', last && 'rounded-b-xl border-b')

type Row =
  | { kind: 'day'; label: string }
  | { kind: 'item'; item: InboxItem; first: boolean; last: boolean }
  | { kind: 'group'; group: InboxGroup; open: boolean; first: boolean; last: boolean }
  | { kind: 'entry'; item: InboxItem; open: boolean; last: boolean }
  | { kind: 'more'; group: InboxGroup; last: boolean }

const rowKey = (r: Row) => (r.kind === 'day' ? `d:${r.label}` : r.kind === 'group' ? `g:${r.group.key}` : r.kind === 'more' ? `m:${r.group.key}` : r.item.id)

function SectionTitle({ label, count, dot }: { label: string; count?: string | number; dot?: string }) {
  return (
    <View className="mb-2 flex-row items-center gap-2">
      {!!dot && <View className={cn('h-2 w-2 rounded-full', dot)} />}
      <Text className={cn('font-medium text-foreground/90', D ? 'text-[12.5px]' : 'text-sm')}>{label}</Text>
      {count !== undefined && <Text className={cn('font-medium tabular-nums text-muted-foreground', D ? 'text-[12.5px]' : 'text-sm')}>{count}</Text>}
    </View>
  )
}

const KIND_FILTERS: InboxKindFilter[] = ['all', 'requests', 'done', 'error']
const kindFilterFrom = (v: string | null): InboxKindFilter => (KIND_FILTERS.includes(v as InboxKindFilter) ? (v as InboxKindFilter) : 'all')
// The filters survive switching tabs (module state, like the scroll position) and restarts (stored;
// older builds stored the source as hermes | paseo, sourceFilterFrom maps them to chats | agents).
let lastKind: InboxKindFilter = 'all'
let lastSource: InboxSourceFilter = 'all'
const KIND_KEY = 'hk_inbox_kind'
const SOURCE_KEY = 'hk_inbox_source'
const storedFilters = Promise.all([AsyncStorage.getItem(KIND_KEY), AsyncStorage.getItem(SOURCE_KEY)])
  .then(([k, s]) => { lastKind = kindFilterFrom(k); lastSource = sourceFilterFrom(s) }, () => {})
const add = (set: Set<string>, key: string) => (set.has(key) ? set : new Set(set).add(key))
const flip = (set: Set<string>, key: string) => { const next = new Set(set); if (!next.delete(key)) next.add(key); return next }

export function Inbox() {
  const inbox = useStore((s) => s.inbox)
  const focus = useStore((s) => s.inboxFocus)
  const tab = useStore((s) => s.tab)
  const [refreshing, setRefreshing] = useState(false)
  const [kind, setKindState] = useState<InboxKindFilter>(lastKind)
  const [source, setSourceState] = useState<InboxSourceFilter>(lastSource)
  const setKind = (k: InboxKindFilter) => { lastKind = k; setKindState(k); AsyncStorage.setItem(KIND_KEY, k).catch(() => {}) }
  const setSource = (k: InboxSourceFilter) => { lastSource = k; setSourceState(k); AsyncStorage.setItem(SOURCE_KEY, k).catch(() => {}) }
  useEffect(() => { storedFilters.then(() => { setKindState(lastKind); setSourceState(lastSource) }) }, [])
  // Expanded automation groups (by group key), entries (by id), groups showing all their entries.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [openEntries, setOpenEntries] = useState<Set<string>>(() => new Set())
  const [allEntries, setAllEntries] = useState<Set<string>>(() => new Set())
  // The entry a notification or toast pointed at: scrolled to once its row exists, tinted for a moment.
  const [flash, setFlash] = useState<string | null>(null)
  const scrollTo = useRef<string | null>(null)
  const list = useRef<FlashListRef<Row>>(null)

  const toggleGroup = useCallback((key: string) => setOpenGroups((g) => flip(g, key)), [])
  const toggleEntry = useCallback((item: InboxItem) => {
    setOpenEntries((e) => flip(e, item.id))
    if (!item.read) markRead([item.id])
  }, [])

  // #/inbox/item/<id> (a push, a local notification) or a toast: that entry expanded, scrolled to, read.
  useEffect(() => {
    if (!focus || tab !== 'inbox') return
    const item = inbox.items.find((x) => x.id === focus)
    if (!item) return // not loaded yet: the focus waits for the next inbox update
    focusInboxItem(null)
    if (!matchesSource(item.source, source)) setSource('all')
    if (!matchesKind(item, kind)) setKind('all')
    if (isAutomation(item)) {
      const key = groupKey(item)
      setOpenGroups((g) => add(g, key))
      setOpenEntries((e) => add(e, item.id))
      setAllEntries((a) => add(a, key))
    }
    if (!item.read) markRead([item.id])
    scrollTo.current = item.id
    setFlash(item.id)
  }, [focus, tab, inbox.items])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(timer)
  }, [flash])

  const open = inbox.open.filter((o) => matchesSource(o.source, source) && (kind === 'all' || kind === 'requests'))
  const rows = useMemo(() => {
    const items = inbox.items.filter((it) => matchesSource(it.source, source) && matchesKind(it, kind)
      // Requests that are still open are shown above, not twice.
      && !(isRequest(it) && !it.resolution && inbox.open.some((o) => o.key === it.id)))
    const entries = historyEntries(items)
    const labels = entries.map((e) => dayLabel(e.at))
    const out: Row[] = []
    entries.forEach((e, i) => {
      const label = labels[i]
      const first = i === 0 || labels[i - 1] !== label
      const last = labels[i + 1] !== label
      if (first) out.push({ kind: 'day', label })
      if (e.type === 'item') { out.push({ kind: 'item', item: e.item, first, last }); return }
      const g = e.group
      const isOpen = openGroups.has(g.key)
      out.push({ kind: 'group', group: g, open: isOpen, first, last })
      if (!isOpen) return
      const shown = allEntries.has(g.key) ? g.items : g.items.slice(0, GROUP_PAGE)
      const more = shown.length < g.items.length
      shown.forEach((it, j) => out.push({ kind: 'entry', item: it, open: openEntries.has(it.id), last: last && !more && j === shown.length - 1 }))
      if (more) out.push({ kind: 'more', group: g, last })
    })
    return out
  }, [inbox.items, inbox.open, kind, source, openGroups, openEntries, allEntries])

  useEffect(() => {
    const id = scrollTo.current
    if (!id) return
    const index = rows.findIndex((r) => (r.kind === 'item' || r.kind === 'entry') && r.item.id === id)
    if (index < 0) return
    scrollTo.current = null
    // Twice: the first jump lands on estimated heights; the second, once the rows are measured, on the row.
    const go = () => list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 })?.catch(() => {})
    const a = setTimeout(go, 50)
    const b = setTimeout(go, 450)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [rows])

  const kinds = <Segmented value={kind} onChange={setKind} grow={!D} options={[{ id: 'all', label: t('Alle') }, { id: 'requests', label: t('Freigaben') }, { id: 'done', label: t('Fertig') }, { id: 'error', label: t('Fehler') }]} />
  const sources = <Segmented value={source} onChange={setSource} grow={!D} fit options={[{ id: 'all', label: t('Alle Quellen') }, { id: 'chats', label: t('Chats') }, { id: 'agents', label: t('Agents') }, { id: 'automations', label: t('Automationen') }]} />
  const toolbar = D ? (
    <View className="flex-row flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      {kinds}
      {sources}
      <Button variant="ghost" size="sm" className="ml-auto" disabled={!inbox.unread} onPress={() => markRead('all')}><Icon as={CheckCheck} size={14} /><Text className="text-xs">{t('Alle gelesen')}</Text></Button>
    </View>
  ) : (
    // Phones: kinds and "mark all read" in one row, the sources in a row of their own.
    <View className="gap-2 border-b border-border px-3 py-2">
      <View className="flex-row items-center gap-2">
        {kinds}
        <Button variant="ghost" size="icon-sm" disabled={!inbox.unread} onPress={() => markRead('all')} accessibilityLabel={t('Alle gelesen')}><Icon as={CheckCheck} size={18} /></Button>
      </View>
      <View className="flex-row">{sources}</View>
    </View>
  )
  return (
    <View className="flex-1">
    {toolbar}
    <FlashList
      ref={list}
      data={rows}
      extraData={flash}
      keyExtractor={rowKey}
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
        : r.kind === 'item' ? <HistoryRow item={r.item} first={r.first} last={r.last} flash={flash === r.item.id} />
          : r.kind === 'group' ? <GroupRow group={r.group} open={r.open} first={r.first} last={r.last} onToggle={toggleGroup} />
            : r.kind === 'entry' ? <EntryRow item={r.item} open={r.open} last={r.last} flash={flash === r.item.id} onToggle={toggleEntry} />
              : (
                <Pressable onPress={() => setAllEntries((a) => add(a, r.group.key))} accessibilityRole="button"
                  className={cn('bg-card', CARD_ROW, cardEdges(false, r.last), 'border-t-border/40 py-2', D ? 'pl-10' : 'pl-8')}>
                  <Text className="text-xs text-primary">{t('{n} ältere anzeigen', { n: r.group.items.length - GROUP_PAGE })}</Text>
                </Pressable>
              )}
    />
    </View>
  )
}
