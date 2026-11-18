import { useEffect, useMemo, useState } from 'react'
import { BellRing, Bot, Check, CheckCheck, CheckCircle2, CircleHelp, ExternalLink, MessageSquareShare, ShieldAlert, TriangleAlert, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Textarea } from '@/components/ui/textarea'
import { OverlayScroll } from '@/components/common/OverlayScroll'
import { PendingPrompt } from '@/components/thread/PendingPrompt'
import { cn } from '@/lib/utils'
import { relTime } from '@/lib/format'
import { kindLabel, loadInbox, markRead, openThread, respondPaseo, useBoard } from '@/lib/store'
import type { InboxItem, OpenItem } from '@/lib/types'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

type KindFilter = 'all' | 'requests' | 'done' | 'error'
const REQUESTS = new Set(['approval', 'clarify', 'permission'])
const matchesKind = (k: string, f: KindFilter) =>
  f === 'all' || (f === 'requests' ? REQUESTS.has(k) : f === 'done' ? k === 'done' || k === 'paseo-done' : k === 'error' || k === 'paseo-error' || k === 'paseo-limit')

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
  const [kind, setKind] = useState<KindFilter>(() => (localStorage.getItem('hk_inbox_kind') as KindFilter) || 'all')
  const [source, setSource] = useState<string>(() => localStorage.getItem('hk_inbox_source') || 'all')
  useEffect(() => { if (!inbox.loaded) loadInbox() }, [inbox.loaded])
  useEffect(() => { localStorage.setItem('hk_inbox_kind', kind); localStorage.setItem('hk_inbox_source', source) }, [kind, source])

  const open = inbox.open.filter((o) => (source === 'all' || o.source === source) && (kind === 'all' || kind === 'requests'))
  const groups = useMemo(() => {
    const out: { label: string; items: InboxItem[] }[] = []
    for (const it of inbox.items) {
      if (source !== 'all' && it.source !== source) continue
      if (!matchesKind(it.kind, kind)) continue
      // Requests that are still open are shown above, not twice.
      if (REQUESTS.has(it.kind) && !it.resolution && inbox.open.some((o) => o.key === it.id)) continue
      const label = dayLabel(it.at)
      if (out[out.length - 1]?.label !== label) out.push({ label, items: [] })
      out[out.length - 1].items.push(it)
    }
    return out
  }, [inbox.items, inbox.open, kind, source])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <ToggleGroup type="single" size="sm" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as KindFilter)} className="text-xs max-md:w-full">
          <ToggleGroupItem value="all" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Alle')}</ToggleGroupItem>
          <ToggleGroupItem value="requests" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Freigaben')}</ToggleGroupItem>
          <ToggleGroupItem value="done" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Fertig')}</ToggleGroupItem>
          <ToggleGroupItem value="error" className="px-2.5 text-xs max-md:flex-1 touch:text-[13px]">{t('Fehler')}</ToggleGroupItem>
        </ToggleGroup>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger size="sm" className="h-8 w-[112px] text-xs touch:w-auto touch:text-[13px]" aria-label={t('Quelle')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('Alle Quellen')}</SelectItem>
            <SelectItem value="hermes">Hermes</SelectItem>
            <SelectItem value="paseo">Paseo</SelectItem>
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
            {!groups.length && <div className="py-6 text-center text-xs text-muted-foreground">{inbox.loaded ? t('Noch keine Benachrichtigungen.') : '…'}</div>}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{g.label}</div>
                <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/70">
                  {g.items.map((it, i) => <HistoryRow key={it.id} it={it} first={i === 0} />)}
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
  if (!r) return REQUESTS.has(it.kind) ? t('offen') : null
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
    <button onClick={click} className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50', !first && 'border-t border-border/60')}>
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
