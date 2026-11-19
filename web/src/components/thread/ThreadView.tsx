import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AlertTriangle, Archive, Bell, ShieldCheck, ChevronRight, CircleStop, Clock, CornerDownRight, FileText, FlaskConical, RotateCcw, Webhook, Wrench, X, Zap } from 'lucide-react'
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from '@/components/ui/chat-container'
import { Markdown } from '@/components/ui/markdown'
import { Loader } from '@/components/ui/loader'
import { ScrollButton } from '@/components/ui/scroll-button'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { clock } from '@/lib/format'
import { COLUMNS, type Attachment, type Column, type OutboxState, type OutgoingMessage, type PaseoChip, type ThreadMessage } from '@/lib/types'
import { AGENT_STATE, AgentStateDot, AgentIcon, agentKindLabel } from '@/components/paseo/AgentChip'
import { stripMediaTags } from '@/lib/media-tags'
import { clearHighlight, dismissOutbox, getState, interrupt, openThread, retryOutbox, sendMessage, setColumn, useBoard } from '@/lib/store'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { SourceIcon, StatusDot } from '@/components/board/status'
import { Composer } from './Composer'
import { PendingPrompt } from './PendingPrompt'
import { SummaryPill } from './SummaryPill'
import { useSummaryPill } from '@/hooks/use-summary-pill'
import { MediaAudio, MediaImage } from '@/components/common/Media'
import { PaseoPanel } from '@/components/paseo/PaseoPanel'
import { OverlayScroll } from '@/components/common/OverlayScroll'
import { Bot, MessagesSquare } from 'lucide-react'
import { t } from '@/lib/i18n'
import { useIsMobile } from '@/hooks/use-mobile'
import { ColumnSheet } from '@/components/board/ColumnSheet'
import { COLUMN_COLOR } from '@/components/board/status'
import { ChevronDown } from 'lucide-react'

const MESSAGING = new Set(['kanban', 'desktop', 'cli', 'oneshot'])

function ToolChip({ m }: { m: ThreadMessage }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs">
      <button
        onClick={() => m.text && setOpen((o) => !o)}
        className={cn('touch-hitbox inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground transition-colors touch:py-1.5', m.text && 'hover:text-foreground')}
      >
        {m.live ? <Loader variant="circular" size="sm" className="size-3" /> : <Wrench className="size-3 shrink-0" />}
        <span className="font-mono">{m.toolName}</span>
        {m.summary && <span className="truncate opacity-80">· {m.summary}</span>}
        {m.text && <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted/60 p-2 font-mono text-[11.5px] ring-1 ring-border">{m.text}</pre>}
    </div>
  )
}

/** Search hit: stop following the bottom, scroll the message into view and mark it briefly. */
function JumpToHighlight() {
  const highlight = useBoard((s) => s.highlight)
  const count = useBoard((s) => s.messages.length)
  const { stopScroll } = useStickToBottomContext()
  useEffect(() => {
    if (highlight == null || !count) return
    const el = document.getElementById(`msg-${highlight}`)
    if (!el) return
    stopScroll()
    // Long messages: aim at the first matching word, not the middle of the message.
    const terms = getState().highlightQuery.toLowerCase().split(/\s+/).filter(Boolean)
    let target: Element = el
    if (terms.length) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (terms.some((w) => n!.textContent?.toLowerCase().includes(w))) { target = n.parentElement || el; break }
      }
    }
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }))
    const timer = setTimeout(clearHighlight, 4000)
    return () => clearTimeout(timer)
  }, [highlight, count, stopScroll])
  return null
}

function MessageRow({ m }: { m: ThreadMessage }) {
  const highlighted = useBoard((s) => m.id != null && s.highlight === m.id)
  return (
    <div id={m.id != null ? `msg-${m.id}` : undefined} className={cn('-mx-2 rounded-xl px-2 transition-[background-color,box-shadow] duration-700', highlighted && 'bg-amber-400/10 ring-1 ring-amber-500/40')}>
      <MessageBody m={m} />
    </div>
  )
}

const EVENT_ICON: Record<string, typeof Bell> = { webhook: Webhook, cron: Clock, scheduled: Clock, process: Zap, delegation: Zap }
const EVENT_LABEL: Record<string, string> = { webhook: 'Webhook', cron: 'Cron', scheduled: 'Geplanter Lauf', process: 'Hintergrundprozess', delegation: 'Subagent', compaction: 'Kontext verdichtet' }

/** Delivered into the session, not typed by the user: collapsed card with route and title, Markdown on demand. */
function EventCard({ m }: { m: ThreadMessage }) {
  const [open, setOpen] = useState(false)
  const ev = m.event!
  const Icon = EVENT_ICON[ev.source] || Bell
  return (
    <div className="rounded-xl border bg-muted/30 text-sm" data-testid="event-card">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate font-medium">{t(EVENT_LABEL[ev.source] || 'Event')}{ev.route ? ` · ${ev.route}` : ''}</span>
            {m.ts && <span className="ml-auto shrink-0 text-[10.5px] touch:text-[11px]">{clock(m.ts)}</span>}
          </span>
          <span className="mt-0.5 line-clamp-2 font-medium text-foreground/90">{ev.title}</span>
        </span>
        <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open && m.text && (
        <div className="border-t px-3 py-2">
          <Markdown className="prose prose-sm prose-zinc max-w-none break-words text-foreground dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">{m.text}</Markdown>
        </div>
      )}
    </div>
  )
}

const OUTBOX_LABEL: Record<OutboxState['status'] | 'steer', string> = {
  sending: 'wird gesendet …',
  waiting: 'wartet · läuft nach dem aktuellen Turn',
  queued: 'wartet · läuft nach dem aktuellen Turn',
  started: 'wird übernommen …',
  steer: 'wartet · wird nach dem aktuellen Schritt übernommen',
  lost: 'nicht übernommen',
  failed: 'nicht zugestellt',
}

// Outcomes of an admission in Hermes' FIFO that ended without a turn.
const OUTCOME: Record<string, string> = { cancelled: 'abgebrochen', interrupted: 'unterbrochen', failed: 'fehlgeschlagen' }

function OutboxBadge({ sessionId, o }: { sessionId: string; o: OutboxState }) {
  const bad = o.status === 'lost' || o.status === 'failed'
  const error = o.error && (OUTCOME[o.error] ? t(OUTCOME[o.error]) : o.error)
  return (
    <div className="mt-1.5 flex max-w-[85%] flex-col items-end gap-1 text-[11px]" data-testid="outbox-badge">
    <div className={cn('flex flex-wrap items-center justify-end gap-x-2 gap-y-1', bad ? 'text-destructive' : 'text-muted-foreground')}>
      {bad ? <AlertTriangle className="size-3" /> : <Loader variant="circular" size="sm" className="size-3" />}
      <span>{t(OUTBOX_LABEL[o.status === 'waiting' ? (o.mode === 'redirected' || o.mode === 'steered' ? 'steer' : o.mode === 'queued' ? 'queued' : 'sending') : o.status])}{bad && error && OUTCOME[o.error!] ? ` · ${error}` : ''}</span>
      {bad && o.id && (
        <span className="inline-flex items-center gap-2 touch:w-full touch:justify-end">
          <button onClick={() => retryOutbox(sessionId, o.id!)} className="touch-hitbox inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground ring-1 ring-border hover:bg-muted touch:h-9 touch:px-3 touch:text-xs"><RotateCcw className="size-3" />{t('Erneut senden')}</button>
          <button onClick={() => dismissOutbox(sessionId, o.id!)} className="touch-hitbox rounded-md px-1.5 py-0.5 text-muted-foreground hover:text-foreground touch:h-9 touch:px-3 touch:text-xs">{t('Verwerfen')}</button>
        </span>
      )}
    </div>
    {bad && error && !OUTCOME[o.error!] && <div className="text-right text-destructive/80 [overflow-wrap:anywhere]">{error}</div>}
    </div>
  )
}

function UserMeta({ m }: { m: ThreadMessage }) {
  const [ctx, setCtx] = useState(false)
  const reply = m.meta?.find((x) => x.kind === 'reply')
  const origin = m.meta?.find((x) => x.kind === 'origin')
  if (!reply && !origin && !m.steer && !m.threadContext) return null
  return (
    <div className="mb-1 flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
      {reply && <div className="inline-flex max-w-full items-center gap-1"><CornerDownRight className="size-3 shrink-0" /><span className="truncate">{t('Antwort auf „{q}“', { q: reply.text })}</span></div>}
      {(origin || m.steer || m.threadContext) && (
        <div className="flex flex-wrap justify-end gap-x-2">
          {m.steer && <span>{t('während des Turns eingeworfen')}</span>}
          {origin && <span>{t('via {where}', { where: origin.text })}</span>}
          {m.threadContext && <button onClick={() => setCtx((c) => !c)} className="touch-hitbox underline-offset-2 hover:underline">{ctx ? t('Thread-Kontext ausblenden') : t('Thread-Kontext')}</button>}
        </div>
      )}
      {ctx && m.threadContext && <pre className="mt-1 max-h-56 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-left font-sans text-[11.5px] ring-1 ring-border">{m.threadContext}</pre>}
    </div>
  )
}

// Live Paseo state of the open session + "open this agent's transcript" for inline agent items.
const PaseoCtx = createContext<{ chips: PaseoChip[]; open: (agentId: string, msgId?: number) => void }>({ chips: [], open: () => {} })

function duration(from?: string | null, to?: number, fallbackStart?: number) {
  const start = from ? Date.parse(from) : fallbackStart ?? NaN
  if (!Number.isFinite(start)) return ''
  const min = Math.max(0, Math.round(((to ?? Date.now()) - start) / 60000))
  return min < 1 ? '<1 min' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

/** Hermes started (or messaged / archived) a Paseo agent here: live state, click opens its transcript. */
function PaseoInline({ m }: { m: ThreadMessage }) {
  const { chips, open } = useContext(PaseoCtx)
  const p = m.paseo!
  const chip = p.agentId ? chips.find((c) => c.id === p.agentId) : undefined
  const state = chip?.state || 'unknown'
  const st = AGENT_STATE[state] || AGENT_STATE.unknown
  const title = chip?.title || p.title || p.ref.slice(0, 8)
  const who = chip ?? { provider: p.provider, kind: p.kind ?? null, account: p.account ?? null }
  const running = state === 'running'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(timer)
  }, [running])
  const clickable = !!p.agentId && !!chip
  const go = () => clickable && open(p.agentId!, m.id)

  if (p.action !== 'create') {
    const Icon = p.action === 'archive' ? Archive : p.action === 'permission' ? ShieldCheck : CornerDownRight
    const what = p.action === 'archive' ? t('Agent „{title}“ archiviert', { title })
      : p.action === 'permission' ? t('Freigabe für „{title}“ beantwortet', { title })
        : t('Nachricht an „{title}“', { title })
    return (
      <button onClick={go} disabled={!clickable} className={cn('touch-hitbox flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground', clickable && 'hover:text-foreground')} data-testid="paseo-line">
        <Icon className="size-3.5 shrink-0" />
        <span className="shrink-0">{what}</span>
        {p.text && <span className="truncate opacity-70">· {p.text}</span>}
      </button>
    )
  }
  const end = running ? undefined : chip?.updatedAt ? Date.parse(chip.updatedAt) : undefined
  return (
    <button
      onClick={go}
      disabled={!clickable}
      data-testid="paseo-card"
      className={cn('group flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-colors', clickable ? 'hover:border-foreground/20' : 'opacity-70', chip?.archived && 'opacity-60')}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted ring-1 ring-border/60">
        {running ? <Loader variant="circular" size="sm" className="size-4" /> : <AgentIcon a={who} className="size-4 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-snug">{title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
          {who.provider === 'hermes' && <span>{agentKindLabel(who)}</span>}
          <span className={cn('inline-flex items-center gap-1.5', st.text)}><AgentStateDot state={state} />{chip ? st.label : t('unbekannt / gelöscht')}</span>
          {who.provider !== 'hermes' && (chip?.account || p.account) && <span>Account {chip?.account || p.account}</span>}
          {chip && <span className="tabular-nums">{duration(chip.createdAt, end, m.ts ? m.ts * 1000 : undefined)}</span>}
          {!!chip?.pendingCount && <span className="text-amber-700 dark:text-amber-300">{t('{n} Freigabe(n) offen', { n: chip.pendingCount })}</span>}
        </span>
      </span>
      {clickable && <span className="hidden shrink-0 text-[11px] text-muted-foreground group-hover:inline sm:inline">{t('Transkript')}</span>}
      {clickable && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </button>
  )
}

/** Back from a transcript opened in the chat: scroll to the agent card that opened it. */
function ReturnTo({ msgId, done }: { msgId: number | null; done: () => void }) {
  const { stopScroll } = useStickToBottomContext()
  useEffect(() => {
    if (msgId == null) return
    stopScroll()
    const go = () => document.getElementById(`msg-${msgId}`)?.scrollIntoView({ block: 'center' })
    requestAnimationFrame(go)
    const timer = setTimeout(() => { go(); done() }, 120)
    return () => clearTimeout(timer)
  }, [msgId, stopScroll, done])
  return null
}

function MessageBody({ m }: { m: ThreadMessage }) {
  const sessionId = useBoard((s) => s.openId)
  if (m.role === 'tool') return <ToolChip m={m} />
  if (m.role === 'paseo' && m.paseo) return <PaseoInline m={m} />
  if (m.role === 'event' && m.event) return <EventCard m={m} />
  const atts = m.attachments || []
  if (m.role === 'user') {
    const pending = m.outbox && m.outbox.status !== 'lost' && m.outbox.status !== 'failed'
    return (
      <div className="flex flex-col items-end">
        <UserMeta m={m} />
        <div className={cn('max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm text-foreground ring-1 ring-border/60', pending && 'opacity-60', m.outbox && !pending && 'ring-destructive/50')}>
          {m.text && <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</div>}
          {atts.map((a) => (a.kind === 'audio'
            ? <MediaAudio key={a.url} url={a.url} className="mt-2 h-9 w-64 max-w-full" />
            : a.kind === 'image'
              ? <div key={a.url} className="mt-2"><MediaImage url={a.url} className="max-h-64" /></div>
              : <span key={a.name} className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs text-muted-foreground" title={a.name}><FileText className="size-3.5 shrink-0" /><span className="truncate">{a.name}</span></span>))}
          {m.ts && <div className="mt-1 text-right text-[10.5px] text-muted-foreground touch:text-[11px]">{clock(m.ts)}</div>}
        </div>
        {m.outbox && sessionId && <OutboxBadge sessionId={sessionId} o={m.outbox} />}
      </div>
    )
  }
  return (
    <div className="group">
      {m.text && <Markdown className="prose prose-sm prose-zinc max-w-none break-words text-foreground dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">{m.text}</Markdown>}
      {atts.length > 0 && <AssistantAttachments atts={atts} />}
      {m.ts && <div className="mt-1 text-[10.5px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 touch:text-[11px] touch:opacity-100">{clock(m.ts)}</div>}
    </div>
  )
}

/** Files Hermes attached to a reply with MEDIA:<path>: images (lightbox on click), audio, other files by name. */
function AssistantAttachments({ atts }: { atts: Attachment[] }) {
  const images = atts.filter((a) => a.kind === 'image')
  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      {images.length === 1 && <MediaImage url={images[0].url} className="max-h-[28rem]" />}
      {images.length > 1 && (
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a) => <MediaImage key={a.url} url={a.url} className="aspect-[4/3] w-full object-cover object-top" />)}
        </div>
      )}
      {atts.map((a) => (a.kind === 'audio'
        ? <MediaAudio key={a.url} url={a.url} className="h-9 w-64 max-w-full" />
        : a.kind === 'file' && (
          <span key={a.name} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground" title={a.name}>
            <FileText className="size-3.5 shrink-0" /><span className="truncate">{a.name}</span>
          </span>
        )))}
    </div>
  )
}

export function ThreadView({ onClose }: { onClose?: () => void }) {
  const id = useBoard((s) => s.openId)
  const session = useBoard((s) => (s.openId ? s.sessions[s.openId] : null))
  const messages = useBoard((s) => s.messages)
  const loading = useBoard((s) => s.loadingThread)
  const streaming = useBoard((s) => (s.streaming && s.streaming.id === s.openId ? s.streaming.text : ''))
  const [tab, setTab] = useState<'chat' | 'paseo'>('chat')
  const [agentOpen, setAgentOpen] = useState<string | null>(null)
  // Set when a transcript was opened from an inline card: back returns to that spot in the chat.
  const [fromMsg, setFromMsg] = useState<number | null>(null)
  const [returnTo, setReturnTo] = useState<number | null>(null)
  const [columnSheet, setColumnSheet] = useState(false)
  const isMobile = useIsMobile()
  useEffect(() => { setTab('chat'); setAgentOpen(null); setFromMsg(null); setReturnTo(null) }, [id])
  const clearReturn = useCallback(() => setReturnTo(null), [])
  const summary = useSummaryPill(id || '', messages.length, !!session?.running || !!session?.pending?.length)
  if (!id || !session) return null
  const agentCount = session.paseo?.length || 0
  const openAgent = (agentId: string, msgId?: number) => { setFromMsg(msgId ?? null); setAgentOpen(agentId); setTab('paseo') }
  const backFromAgent = () => {
    setAgentOpen(null)
    if (fromMsg != null) { setReturnTo(fromMsg); setFromMsg(null); setTab('chat') }
  }
  const runningAgents = session.paseo?.filter((a) => a.state === 'running' && a.rel !== 'watches').length || 0

  const confirmForeign = () => MESSAGING.has(session.source)
    || confirm(t('Diese Session gehört zu „{src}“. Hermes kann die Antwort auch dort posten. Trotzdem senden?', { src: session.source }))
  // The composer's send path, also used by the Summary pill.
  const submit = async (msg: OutgoingMessage) => {
    if (!confirmForeign()) throw new Error('abgebrochen')
    return sendMessage(getState().openId!, msg)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Phones: the header is also a drag handle for the sheet (swipe down closes). */}
      <div data-sheet-drag={isMobile || undefined} className="flex items-start gap-3 border-b px-4 py-3 max-md:gap-2 max-md:px-3 max-md:pb-2 max-md:pt-0">
        <StatusDot column={session.column} running={session.running} pending={!!session.pending?.length} className="mt-2 max-md:mt-[0.8125rem]" />
        <div className="min-w-0 flex-1 max-md:pt-1.5">
          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug max-md:text-base max-md:leading-snug max-md:[overflow-wrap:anywhere]">{session.title}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><SourceIcon source={session.source} className="size-3" />{session.source}</span>
            <span>{clock(session.createdAt)}</span>
            <Tooltip><TooltipTrigger asChild><span className="max-w-40 truncate font-mono max-md:hidden">{session.id}</span></TooltipTrigger><TooltipContent>{session.id}</TooltipContent></Tooltip>
            {session.test && <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><FlaskConical className="size-3" />Test</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 max-md:gap-0">
          {isMobile ? (
            <>
              <Button variant="ghost" size="sm" className="gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground" onClick={() => setColumnSheet(true)} aria-label={t('Spalte')} aria-haspopup="dialog">
                <span className={cn('size-2 rounded-full', COLUMN_COLOR[session.column])} />
                {COLUMNS.find((c) => c.id === session.column)?.label.replace(' Task', '')}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
              <ColumnSheet open={columnSheet} onOpenChange={setColumnSheet} title={session.title} current={session.override ? session.column : 'auto'} onPick={(c) => setColumn(session.id, c)} />
            </>
          ) : (
          <Select value={session.override ? session.column : 'auto'} onValueChange={(v) => setColumn(session.id, v as Column | 'auto')}>
            <SelectTrigger size="sm" className="h-8 w-[118px] text-xs" aria-label={t('Spalte')}><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="auto">{t('Automatisch')}</SelectItem>
              {COLUMNS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          )}
          {session.running && (
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => interrupt(session.id)} aria-label={t('Stoppen')}><CircleStop className="size-4" /></Button>
            </TooltipTrigger><TooltipContent>{t('Laufenden Turn stoppen')}</TooltipContent></Tooltip>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => (onClose ? onClose() : openThread(null))} aria-label={t('Schließen')}><X className="size-4" /></Button>
        </div>
      </div>

      {(agentCount > 0 || tab === 'paseo') && (
        <div className="flex items-center gap-1 border-b px-3 py-1.5 max-md:py-1">
          <TabButton active={tab === 'chat'} onClick={() => { setTab('chat'); setAgentOpen(null); setFromMsg(null) }}><MessagesSquare className="size-3.5" />{t('Chat')}</TabButton>
          <TabButton active={tab === 'paseo'} onClick={() => { setTab('paseo'); setAgentOpen(null); setFromMsg(null) }}>
            <Bot className="size-3.5" />{session.paseo?.some((a) => a.provider === 'hermes') ? t('Agents') : t('Paseo-Agents')} <span className="tabular-nums opacity-70">{agentCount}</span>
            {runningAgents > 0 && <span className="size-1.5 animate-pulse rounded-full bg-indigo-500" />}
          </TabButton>
          {session.paseoNote && <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">{session.paseoNote}</span>}
        </div>
      )}

      {tab === 'paseo' ? (
        <OverlayScroll className="flex-1">
          <PaseoPanel
            sessionId={session.id}
            version={(session.paseo || []).map((a) => a.id + a.state).join()}
            open={agentOpen}
            onOpen={(agentId) => { setFromMsg(null); setAgentOpen(agentId) }}
            onBack={backFromAgent}
            backLabel={fromMsg != null ? t('Zurück zum Chat') : undefined}
          />
        </OverlayScroll>
      ) : (<>
      {session.running && session.activity && !session.pending?.length && (
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
          <Loader variant="text-shimmer" text={session.activity} size="sm" />
        </div>
      )}

      <ChatContainerRoot className="relative min-h-0 flex-1">
        <ChatContainerContent className={cn('flex flex-col gap-4 px-4 py-4', summary.state !== 'hidden' && 'pb-14')}>
          {loading && !messages.length && <div className="flex justify-center py-8"><Loader variant="dots" /></div>}
          {!loading && !messages.length && !streaming && <div className="py-8 text-center text-sm text-muted-foreground">{t('Noch keine Nachrichten.')}</div>}
          <PaseoCtx.Provider value={{ chips: session.paseo || [], open: openAgent }}>
            {messages.map((m, i) => <MessageRow key={m.key ?? m.id ?? `l${i}`} m={m} />)}
          </PaseoCtx.Provider>
          <ReturnTo msgId={returnTo} done={clearReturn} />
          {streaming && (
            <Markdown className="prose prose-sm prose-zinc max-w-none text-foreground dark:prose-invert">{`${stripMediaTags(streaming)}▍`}</Markdown>
          )}
          {session.running && !streaming && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
            <Loader variant="typing" size="sm" />
          )}
          {session.pending?.map((p) => <PendingPrompt key={p.promptId} sessionId={session.id} prompt={p} />)}
          <JumpToHighlight />
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
        <div className="absolute bottom-3 right-4"><ScrollButton className="shadow-sm" /></div>
      </ChatContainerRoot>

      </>)}

      {tab === 'chat' && <div className="relative border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:px-2 max-md:pt-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] [.keyboard-open_&]:pb-2">
        {!session.draft && <SummaryPill state={summary.state} onClick={() => summary.run((text) => submit({ text, images: [], audio: null }))} />}
        <Composer
          key={session.id}
          draftKey={session.id}
          onStop={session.running ? () => interrupt(session.id) : undefined}
          placeholder={session.draft ? 'Entwurf ergänzen und starten …' : t('Antworten …')}
          onSubmit={submit}
        />
      </div>}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn('touch-hitbox inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground touch:h-10 touch:px-3 touch:text-[13px]', active && 'bg-muted text-foreground')}>
      {children}
    </button>
  )
}
