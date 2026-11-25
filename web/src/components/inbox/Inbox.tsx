import { useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Bot, Check, CheckCheck, CheckCircle2, ChevronRight, CircleHelp, Clock, ExternalLink, MessageSquareShare, ShieldAlert, SquareTerminal, TriangleAlert, Webhook, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Textarea } from '@/components/ui/textarea'
import { OverlayScroll } from '@/components/common/OverlayScroll'
import { PendingPrompt } from '@/components/thread/PendingPrompt'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import { relTime } from '@/lib/format'
import { clearInboxFocus, kindLabel, loadInbox, markRead, openThread, respondPaseo, sourceLabel, useBoard } from '@/lib/store'
import type { InboxItem, InboxSource, OpenItem } from '@/lib/types'
import { groupKey, historyEntries, isAutomation, isFailure, isRequest, matchesKind, matchesSource, sourceFilterFrom, type HistoryEntry, type InboxGroup, type InboxKindFilter, type InboxSourceFilter } from '@/lib/inbox-groups'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

const KIND_FILTERS: InboxKindFilter[] = ['all', 'requests', 'done', 'error']
const kindFilterFrom = (v: string | null): InboxKindFilter => (KIND_FILTERS as string[]).includes(v || '') ? (v as InboxKindFilter) : 'all'
const toggle = (set: Set<string>, key: string, on = !set.has(key)) => {
  const next = new Set(set)
  if (on) next.add(key); else next.delete(key)
  return next
}

function dayLabel(ts: number) {
  const d = new Date(ts * 1000)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (diff === 0) return t('Heute')
  if (diff === 1) return t('Gestern')
  return d.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: '2-digit' })
}

export function Inbox({ onSettings }: { onSettings: () => void }) {
  const inbox = useBoard((s) => s.inbox)
  const focus = useBoard((s) => s.inboxFocus)
  const [kind, setKind] = useState<InboxKindFilter>(() => kindFilterFrom(localStorage.getItem('hk_inbox_kind')))
  // Older builds stored hermes | paseo; sourceFilterFrom maps them to chats | agents.
  const [source, setSource] = useState<InboxSourceFilter>(() => sourceFilterFrom(localStorage.getItem('hk_inbox_source')))
  // Expanded automation groups (by group key) and entries (by id).
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [openEntries, setOpenEntries] = useState<Set<string>>(() => new Set())
  const scrollTo = useRef<string | null>(null)
  useEffect(() => { if (!inbox.loaded) loadInbox() }, [inbox.loaded])
  useEffect(() => { localStorage.setItem('hk_inbox_kind', kind); localStorage.setItem('hk_inbox_source', source) }, [kind, source])

  // #/inbox/item/<id> (a push) or a toast: show that entry expanded, scroll to it, mark it read.
  useEffect(() => {
    if (!focus || !inbox.loaded) return
    clearInboxFocus()
    const it = inbox.items.find((x) => x.id === focus)
    if (!it) return
    if (!matchesSource(it.source, source)) setSource('all')
    if (!matchesKind(it, kind)) setKind('all')
    if (isAutomation(it)) {
      setOpenGroups((g) => toggle(g, groupKey(it), true))
      setOpenEntries((e) => toggle(e, it.id, true))
    }
    if (!it.read) markRead([it.id])
    scrollTo.current = it.id
  }, [focus, inbox.loaded, inbox.items, source, kind])

  const open = inbox.open.filter((o) => matchesSource(o.source, source) && (kind === 'all' || kind === 'requests'))
  const days = useMemo(() => {
    const items = inbox.items.filter((it) => matchesSource(it.source, source) && matchesKind(it, kind)
      // Requests that are still open are shown above, not twice.
      && !(isRequest(it) && !it.resolution && inbox.open.some((o) => o.key === it.id)))
    const out: { label: string; entries: HistoryEntry[] }[] = []
    for (const e of historyEntries(items)) {
      const label = dayLabel(e.at)
      if (out[out.length - 1]?.label !== label) out.push({ label, entries: [] })
      out[out.length - 1].entries.push(e)
    }
    return out
  }, [inbox.items, inbox.open, kind, source])

  // After the render that shows the focused entry expanded.
  useEffect(() => {
    const el = scrollTo.current && document.getElementById(`inbox-entry-${scrollTo.current}`)
    if (!el) return
    scrollTo.current = null
    el.scrollIntoView({ block: 'center' })
  }, [days, openEntries, focus])

  const toggleEntry = (it: InboxItem) => {
    const opening = !openEntries.has(it.id)
    setOpenEntries((e) => toggle(e, it.id, opening))
    if (opening && !it.read) markRead([it.id])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <ToggleGroup type="single" size="sm" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as InboxKindFilter)} className="text-xs max-md:w-full">
          <ToggleGroupItem value="all" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Alle')}</ToggleGroupItem>
          <ToggleGroupItem value="requests" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Freigaben')}</ToggleGroupItem>
          <ToggleGroupItem value="done" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Fertig')}</ToggleGroupItem>
          <ToggleGroupItem value="error" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Fehler')}</ToggleGroupItem>
        </ToggleGroup>
        <Select value={source} onValueChange={(v) => setSource(v as InboxSourceFilter)}>
          <SelectTrigger size="sm" className="h-8 w-[128px] text-xs touch:w-auto touch:text-[13px]" aria-label={t('Quelle')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('Alle Quellen')}</SelectItem>
            <SelectItem value="chats">{t('Chats')}</SelectItem>
            <SelectItem value="agents">{t('Agents')}</SelectItem>
            <SelectItem value="automations">{t('Automationen')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={!inbox.unread} onClick={() => markRead('all')} aria-label={t('Alle gelesen')}>
            <CheckCheck className="size-3.5" /><span className="hidden sm:inline">{t('Alle gelesen')}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onSettings} aria-label={t('Benachrichtigungen')} title={t('Benachrichtigungen')}><BellRing className="size-4" /></Button>
        </div>
      </div>

      <OverlayScroll className="flex-1" viewportClassName="pb-24 md:pb-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-4 sm:px-4">
          <section aria-labelledby="inbox-open">
            <h2 id="inbox-open" className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
              <span className={cn('size-2 rounded-full', open.length ? 'bg-amber-500' : 'bg-zinc-400 dark:bg-zinc-500')} />
              <span className="text-foreground/90">{t('Braucht dich')}</span>
              <span className="tabular-nums">{open.length}</span>
            </h2>
            {open.length ? (
              <div className="flex flex-col gap-3">{open.map((o) => <OpenCard key={o.key} item={o} />)}</div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{t('Nichts offen – keine Freigaben oder Rückfragen.')}</div>
            )}
          </section>

          <section aria-labelledby="inbox-history" className="flex flex-col gap-4">
            <h2 id="inbox-history" className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
              <span className="text-foreground/90">{t('Verlauf')}</span>
              {inbox.unread > 0 && <span className="tabular-nums">{t('{n} ungelesen', { n: inbox.unread })}</span>}
            </h2>
            {!days.length && <div className="py-6 text-center text-xs text-muted-foreground">{inbox.loaded ? t('Noch keine Benachrichtigungen.') : '…'}</div>}
            {days.map((d) => (
              <div key={d.label}>
                <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{d.label}</div>
                <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/70">
                  {d.entries.map((e, i) => e.type === 'item'
                    ? <HistoryRow key={e.item.id} it={e.item} first={i === 0} />
                    : (
                      <AutomationGroup
                        key={e.group.key}
                        group={e.group}
                        first={i === 0}
                        open={openGroups.has(e.group.key)}
                        onToggle={() => setOpenGroups((g) => toggle(g, e.group.key))}
                        openEntries={openEntries}
                        onToggleEntry={toggleEntry}
                      />
                    ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </OverlayScroll>
    </div>
  )
}

function OpenHeader({ source, title, sub, at, sessionId }: { source: 'hermes' | 'paseo'; title: string; sub?: string | null; at: number; sessionId: string | null }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold', source === 'hermes' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground ring-1 ring-border')}>
        {source === 'hermes' ? 'H' : <Bot className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{title}</div>
        {sub && <div className="truncate text-muted-foreground">{sub}</div>}
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">{relTime(at)}</span>
      {sessionId && (
        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => openThread(sessionId)} aria-label={t('Im Thread öffnen')}>
          <MessageSquareShare className="size-3.5" /><span className="hidden sm:inline">{t('Im Thread öffnen')}</span>
        </Button>
      )}
    </div>
  )
}

function OpenCard({ item }: { item: OpenItem }) {
  if (item.source === 'hermes') {
    return (
      <div className="rounded-xl bg-card p-3 ring-1 ring-border/70">
        <OpenHeader source="hermes" title={item.title} sub="Hermes" at={item.at} sessionId={item.sessionId} />
        <PendingPrompt sessionId={item.sessionId} prompt={item.prompt} />
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border/70">
      <OpenHeader
        source="paseo"
        title={item.agent.title || item.agent.id.slice(0, 8)}
        sub={[`Paseo${item.agent.account ? ` · ${item.agent.account}` : ''}`, item.title ? t('aus „{chat}“', { chat: item.title }) : null].filter(Boolean).join(' · ')}
        at={item.at}
        sessionId={item.sessionId}
      />
      <PaseoPermission item={item} />
    </div>
  )
}

function PaseoPermission({ item }: { item: Extract<OpenItem, { source: 'paseo' }> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const p = item.permission
  const go = async (decision: 'allow' | 'deny') => {
    haptic()
    setBusy(decision)
    const ok = await respondPaseo(item.agent.id, p.id, decision, decision === 'deny' ? reason.trim() || t('Abgelehnt in Hermes UI') : undefined)
    if (!ok) setBusy(null)
  }
  return (
    <div className="rounded-lg border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/[0.06] p-3 text-sm dark:bg-amber-500/[0.08]">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <ShieldAlert className="size-3.5" />{t('Paseo-Freigabe')}
        <span className="ml-auto font-mono font-normal normal-case tracking-normal">{p.name}</span>
      </div>
      {p.title && <p className="mb-1 font-medium text-foreground">{p.title}</p>}
      {p.description && <p className="mb-2 whitespace-pre-wrap text-foreground/90">{p.description}</p>}
      {p.command && <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-background/80 p-2 font-mono text-xs ring-1 ring-border">{p.command}</pre>}
      {item.agent.cwd && <p className="mb-3 truncate font-mono text-[11px] text-muted-foreground">{item.agent.cwd}</p>}
      {!item.canRespond ? (
        <p className="text-xs text-muted-foreground">{t('Antworten ist hier aus (paseo-mcp nicht verfügbar oder HERMES_UI_PASEO_RESPOND=off). In Paseo beantworten:')}{' '}
          {item.agent.deepLink && <a className="underline" href={item.agent.deepLink}>Paseo ↗</a>}
        </p>
      ) : denying ? (
        <div className="flex flex-col gap-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="min-h-9 resize-none bg-background/80 text-sm" placeholder={t('Begründung für den Agent (optional)')} autoFocus />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => go('deny')}><X className="size-3.5" />{t('Ablehnen senden')}</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setDenying(false)}>{t('Abbrechen')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="sm" disabled={!!busy} onClick={() => go('allow')} className="w-full sm:w-auto"><Check className="size-3.5" />{t('Erlauben')}</Button>
          {item.agent.deepLink && (
            <Button size="sm" variant="outline" asChild className="w-full sm:w-auto"><a href={item.agent.deepLink}><ExternalLink className="size-3.5" />Paseo</a></Button>
          )}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setDenying(true)} className="w-full text-destructive hover:text-destructive sm:ml-auto sm:w-auto"><X className="size-3.5" />{t('Ablehnen')}</Button>
        </div>
      )}
    </div>
  )
}

const ICON: Record<string, { Icon: typeof Check; cls: string }> = {
  approval: { Icon: ShieldAlert, cls: 'text-amber-600 dark:text-amber-400' },
  permission: { Icon: ShieldAlert, cls: 'text-amber-600 dark:text-amber-400' },
  clarify: { Icon: CircleHelp, cls: 'text-amber-600 dark:text-amber-400' },
  done: { Icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400' },
  'paseo-done': { Icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400' },
  error: { Icon: XCircle, cls: 'text-red-600 dark:text-red-400' },
  'paseo-error': { Icon: XCircle, cls: 'text-red-600 dark:text-red-400' },
  'paseo-limit': { Icon: TriangleAlert, cls: 'text-red-600 dark:text-red-400' },
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

function HistoryRow({ it, first }: { it: InboxItem; first: boolean }) {
  const { Icon, cls } = ICON[it.kind] || ICON.done
  const res = resolutionText(it)
  const title = it.source === 'paseo' ? it.agentTitle || it.title : it.title
  const click = () => {
    if (!it.read) markRead([it.id])
    if (it.sessionId) openThread(it.sessionId)
  }
  return (
    <button id={`inbox-entry-${it.id}`} onClick={click} className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50', !first && 'border-t border-border/60')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', cls)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-sm', it.read ? 'text-foreground/80' : 'font-medium text-foreground')}>{title || '—'}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{it.source === 'paseo' ? 'Paseo' : 'Hermes'}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{new Date(it.at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          <span className={cn('size-1.5 shrink-0 rounded-full', it.read ? 'bg-transparent' : 'bg-primary')} aria-label={it.read ? undefined : t('ungelesen')} />
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <span className="text-foreground/70">{kindLabel(it.kind)}</span>
          {it.source === 'paseo' && it.title && it.agentTitle && it.title !== it.agentTitle && <span> · {t('aus „{chat}“', { chat: it.title })}</span>}
          {res && <span> · {res}</span>}
        </div>
        {it.text && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/90 [overflow-wrap:anywhere]">{it.text}</p>}
      </div>
    </button>
  )
}

// ---------- automations (cron runs, webhook runs, POST /api/notify) ----------
const SOURCE_ICON: Partial<Record<InboxSource, typeof Check>> = { cron: Clock, webhook: Webhook, notify: SquareTerminal }
const clockTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
/** Time of day, with the date for entries of an earlier day (a group's entries can span days). */
function stamp(ts: number) {
  const d = new Date(ts * 1000)
  if (d.toDateString() === new Date().toDateString()) return clockTime(ts)
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const statusOf = (it: InboxItem) => (isFailure(it) ? 'error' : it.level === 'warn' ? 'warn' : 'ok')
const STATUS: Record<'ok' | 'warn' | 'error', { Icon: typeof Check; cls: string; label: string }> = {
  ok: { Icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400', label: 'OK' },
  warn: { Icon: TriangleAlert, cls: 'text-amber-600 dark:text-amber-400', label: 'Warnung' },
  error: { Icon: XCircle, cls: 'text-red-600 dark:text-red-400', label: 'Fehler' },
}

/** One job, route or notify group: a row that expands into its entries (newest first). */
function AutomationGroup({ group, first, open, onToggle, openEntries, onToggleEntry }: {
  group: InboxGroup; first: boolean; open: boolean; onToggle: () => void; openEntries: Set<string>; onToggleEntry: (it: InboxItem) => void
}) {
  const Icon = SOURCE_ICON[group.source] || SquareTerminal
  const newest = group.items[0]
  const st = STATUS[group.status === 'error' ? 'error' : statusOf(newest)]
  return (
    <div className={cn(!first && 'border-t border-border/60')} data-testid="automation-group">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
        <Icon className={cn('mt-0.5 size-4 shrink-0', group.status === 'error' ? st.cls : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-sm', group.unread ? 'font-medium text-foreground' : 'text-foreground/80')}>{group.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{sourceLabel(group.source)}</span>
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{clockTime(group.at)}</span>
            {group.unread > 0
              ? <span className="min-w-4 shrink-0 rounded-full bg-primary px-1 text-center text-[10.5px] font-medium leading-4 tabular-nums text-primary-foreground" aria-label={t('{n} ungelesen', { n: group.unread })}>{group.unread}</span>
              : <span className="size-1.5 shrink-0" />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <st.Icon className={cn('size-3 shrink-0', st.cls)} />
            <span className={cn('shrink-0', group.status === 'error' ? st.cls : 'text-foreground/70')}>{t(st.label)}</span>
            {newest.title && <span className="truncate">· {newest.title}</span>}
            {group.items.length > 1 && <span className="ml-auto shrink-0 pl-2 tabular-nums">{t('{n} Einträge', { n: group.items.length })}</span>}
          </div>
        </div>
        <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="border-t border-border/60 bg-muted/20">
          {group.items.map((it, i) => <AutomationEntry key={it.id} it={it} first={i === 0} open={openEntries.has(it.id)} onToggle={() => onToggleEntry(it)} />)}
        </div>
      )}
    </div>
  )
}

/** One run or message: title, one-line preview; expanded the full report (Markdown), link and chat. */
function AutomationEntry({ it, first, open, onToggle }: { it: InboxItem; first: boolean; open: boolean; onToggle: () => void }) {
  const st = STATUS[statusOf(it)]
  return (
    <div id={`inbox-entry-${it.id}`} className={cn(!first && 'border-t border-border/40')} data-testid="automation-entry">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2.5 py-2 pl-6 pr-3 text-left touch:min-h-11 transition-colors hover:bg-muted/50 sm:pl-10">
        <st.Icon className={cn('mt-0.5 size-3.5 shrink-0', st.cls)} aria-label={t(st.label)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-[13px]', it.read ? 'text-foreground/80' : 'font-medium text-foreground')}>{it.title || '—'}</span>
            {(it.repeat ?? 0) > 1 && <span className="shrink-0 rounded bg-muted px-1 text-[11px] tabular-nums text-muted-foreground ring-1 ring-border/60" title={t('{n}× derselbe Fehler', { n: it.repeat! })}>×{it.repeat}</span>}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{stamp(it.at)}</span>
            <span className={cn('size-1.5 shrink-0 rounded-full', it.read ? 'bg-transparent' : 'bg-primary')} aria-label={it.read ? undefined : t('ungelesen')} />
          </div>
          {it.text && !open && <p className="mt-0.5 truncate text-xs text-muted-foreground/90">{it.text}</p>}
        </div>
        <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="pb-3 pl-6 pr-3 sm:pl-10" data-testid="automation-body">
          <div className="pl-6">
            {it.body || it.text
              ? <Markdown className="prose prose-sm prose-zinc max-w-none break-words text-foreground dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">{it.body || it.text}</Markdown>
              : <p className="text-xs text-muted-foreground">{t('Kein Bericht.')}</p>}
            {(it.link || it.sessionId) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {it.sessionId && (
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => openThread(it.sessionId)}>
                    <MessageSquareShare className="size-3.5" />{t('Zum Chat')}
                  </Button>
                )}
                {it.link && (
                  <Button size="sm" variant="ghost" asChild className="min-w-0 max-w-full text-xs">
                    <a href={it.link} target="_blank" rel="noreferrer noopener"><ExternalLink className="size-3.5" /><span className="truncate">{linkLabel(it.link)}</span></a>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** host/path of a link, without the scheme. */
function linkLabel(url: string) {
  try { const u = new URL(url); return `${u.host}${u.pathname === '/' ? '' : u.pathname}` } catch { return url }
}
