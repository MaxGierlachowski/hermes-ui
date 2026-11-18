import { useEffect, useState } from 'react'
import { AlertTriangle, Bell, ChevronRight, CircleStop, Clock, CornerDownRight, FileText, FlaskConical, RotateCcw, Webhook, Wrench, X, Zap } from 'lucide-react'
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from '@/components/ui/chat-container'
import { Markdown } from '@/components/ui/markdown'
import { Loader } from '@/components/ui/loader'
import { ScrollButton } from '@/components/ui/scroll-button'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { clock } from '@/lib/format'
import { COLUMNS, type Attachment, type Column, type OutboxState, type ThreadMessage } from '@/lib/types'
import { stripMediaTags } from '@/lib/media-tags'
import { clearHighlight, dismissOutbox, getState, interrupt, openThread, retryOutbox, sendMessage, setColumn, useBoard } from '@/lib/store'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { SourceIcon, StatusDot } from '@/components/board/status'
import { Composer } from './Composer'
import { PendingPrompt } from './PendingPrompt'
import { MediaAudio, MediaImage } from '@/components/common/Media'
import { PaseoPanel } from '@/components/paseo/PaseoPanel'
import { OverlayScroll } from '@/components/common/OverlayScroll'
import { Bot, MessagesSquare } from 'lucide-react'
import { t } from '@/lib/i18n'

const MESSAGING = new Set(['kanban', 'desktop', 'cli', 'oneshot'])

function ToolChip({ m }: { m: ThreadMessage }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs">
      <button
        onClick={() => m.text && setOpen((o) => !o)}
        className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground transition-colors', m.text && 'hover:text-foreground')}
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
            {m.ts && <span className="ml-auto shrink-0 text-[10.5px]">{clock(m.ts)}</span>}
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
        <>
          <button onClick={() => retryOutbox(sessionId, o.id!)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground ring-1 ring-border hover:bg-muted"><RotateCcw className="size-3" />{t('Erneut senden')}</button>
          <button onClick={() => dismissOutbox(sessionId, o.id!)} className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:text-foreground">{t('Verwerfen')}</button>
        </>
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
          {m.threadContext && <button onClick={() => setCtx((c) => !c)} className="underline-offset-2 hover:underline">{ctx ? t('Thread-Kontext ausblenden') : t('Thread-Kontext')}</button>}
        </div>
      )}
      {ctx && m.threadContext && <pre className="mt-1 max-h-56 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-left font-sans text-[11.5px] ring-1 ring-border">{m.threadContext}</pre>}
    </div>
  )
}

function MessageBody({ m }: { m: ThreadMessage }) {
  const sessionId = useBoard((s) => s.openId)
  if (m.role === 'tool') return <ToolChip m={m} />
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
          {m.ts && <div className="mt-1 text-right text-[10.5px] text-muted-foreground">{clock(m.ts)}</div>}
        </div>
        {m.outbox && sessionId && <OutboxBadge sessionId={sessionId} o={m.outbox} />}
      </div>
    )
  }
  return (
    <div className="group">
      {m.text && <Markdown className="prose prose-sm prose-zinc max-w-none break-words text-foreground dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">{m.text}</Markdown>}
      {atts.length > 0 && <AssistantAttachments atts={atts} />}
      {m.ts && <div className="mt-1 text-[10.5px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{clock(m.ts)}</div>}
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
  useEffect(() => { setTab('chat') }, [id])
  if (!id || !session) return null
  const agentCount = session.paseo?.length || 0
  const runningAgents = session.paseo?.filter((a) => a.state === 'running').length || 0

  const confirmForeign = () => MESSAGING.has(session.source)
    || confirm(t('Diese Session gehört zu „{src}“. Hermes kann die Antwort auch dort posten. Trotzdem senden?', { src: session.source }))

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <StatusDot column={session.column} running={session.running} pending={!!session.pending?.length} className="mt-2" />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug">{session.title}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><SourceIcon source={session.source} className="size-3" />{session.source}</span>
            <span>{clock(session.createdAt)}</span>
            <Tooltip><TooltipTrigger asChild><span className="max-w-40 truncate font-mono">{session.id}</span></TooltipTrigger><TooltipContent>{session.id}</TooltipContent></Tooltip>
            {session.test && <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><FlaskConical className="size-3" />Test</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Select value={session.override ? session.column : 'auto'} onValueChange={(v) => setColumn(session.id, v as Column | 'auto')}>
            <SelectTrigger size="sm" className="h-8 w-[118px] text-xs" aria-label={t('Spalte')}><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="auto">{t('Automatisch')}</SelectItem>
              {COLUMNS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {session.running && (
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => interrupt(session.id)} aria-label={t('Stoppen')}><CircleStop className="size-4" /></Button>
            </TooltipTrigger><TooltipContent>{t('Laufenden Turn stoppen')}</TooltipContent></Tooltip>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => (onClose ? onClose() : openThread(null))} aria-label={t('Schließen')}><X className="size-4" /></Button>
        </div>
      </div>

      {agentCount > 0 && (
        <div className="flex items-center gap-1 border-b px-3 py-1.5">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}><MessagesSquare className="size-3.5" />{t('Chat')}</TabButton>
          <TabButton active={tab === 'paseo'} onClick={() => setTab('paseo')}>
            <Bot className="size-3.5" />{t('Paseo-Agents')} <span className="tabular-nums opacity-70">{agentCount}</span>
            {runningAgents > 0 && <span className="size-1.5 animate-pulse rounded-full bg-indigo-500" />}
          </TabButton>
          {session.paseoNote && <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">{session.paseoNote}</span>}
        </div>
      )}

      {tab === 'paseo' ? (
        <OverlayScroll className="flex-1">
          <PaseoPanel sessionId={session.id} version={(session.paseo || []).map((a) => a.id + a.state).join()} />
        </OverlayScroll>
      ) : (<>
      {session.running && session.activity && !session.pending?.length && (
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
          <Loader variant="text-shimmer" text={session.activity} size="sm" />
        </div>
      )}

      <ChatContainerRoot className="relative min-h-0 flex-1">
        <ChatContainerContent className="flex flex-col gap-4 px-4 py-4">
          {loading && !messages.length && <div className="flex justify-center py-8"><Loader variant="dots" /></div>}
          {!loading && !messages.length && !streaming && <div className="py-8 text-center text-sm text-muted-foreground">{t('Noch keine Nachrichten.')}</div>}
          {messages.map((m, i) => <MessageRow key={m.id ?? `l${i}`} m={m} />)}
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

      {tab === 'chat' && <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer
          placeholder={session.draft ? 'Entwurf ergänzen und starten …' : t('Antworten …')}
          onSubmit={async (msg) => {
            if (!confirmForeign()) throw new Error('abgebrochen')
            await sendMessage(getState().openId!, msg)
          }}
        />
      </div>}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground', active && 'bg-muted text-foreground')}>
      {children}
    </button>
  )
}
