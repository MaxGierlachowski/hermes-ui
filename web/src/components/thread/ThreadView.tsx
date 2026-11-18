import { useEffect, useState } from 'react'
import { ChevronRight, CircleStop, FlaskConical, Wrench, X } from 'lucide-react'
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from '@/components/ui/chat-container'
import { Markdown } from '@/components/ui/markdown'
import { Loader } from '@/components/ui/loader'
import { ScrollButton } from '@/components/ui/scroll-button'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { clock } from '@/lib/format'
import { COLUMNS, type Column, type ThreadMessage } from '@/lib/types'
import { getState, interrupt, openThread, sendMessage, setColumn, useBoard } from '@/lib/store'
import { SourceIcon, StatusDot } from '@/components/board/status'
import { Composer } from './Composer'
import { PendingPrompt } from './PendingPrompt'
import { MediaAudio, MediaImage } from '@/components/common/Media'
import { PaseoPanel } from '@/components/paseo/PaseoPanel'
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
      {open && <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-mono text-[11.5px] ring-1 ring-border">{m.text}</pre>}
    </div>
  )
}

function MessageRow({ m }: { m: ThreadMessage }) {
  if (m.role === 'tool') return <ToolChip m={m} />
  const atts = m.attachments || []
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm text-foreground ring-1 ring-border/60">
          {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
          {atts.map((a) => (a.kind === 'audio'
            ? <MediaAudio key={a.url} url={a.url} className="mt-2 h-9 w-64 max-w-full" />
            : <MediaImage key={a.url} url={a.url} className="mt-2 max-h-64 rounded-lg ring-1 ring-border" />))}
          {m.ts && <div className="mt-1 text-right text-[10.5px] text-muted-foreground">{clock(m.ts)}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="group">
      <Markdown className="prose prose-sm prose-zinc max-w-none break-words text-foreground dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">{m.text}</Markdown>
      {m.ts && <div className="mt-1 text-[10.5px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{clock(m.ts)}</div>}
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PaseoPanel sessionId={session.id} version={(session.paseo || []).map((a) => a.id + a.state).join()} />
        </div>
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
            <Markdown className="prose prose-sm prose-zinc max-w-none text-foreground dark:prose-invert">{`${streaming}▍`}</Markdown>
          )}
          {session.running && !streaming && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
            <Loader variant="typing" size="sm" />
          )}
          {session.pending?.map((p) => <PendingPrompt key={p.promptId} sessionId={session.id} prompt={p} />)}
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
    <button onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground', active && 'bg-muted text-foreground')}>
      {children}
    </button>
  )
}
