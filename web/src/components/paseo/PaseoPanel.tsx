import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Bot, ChevronDown, ChevronRight, ExternalLink, Eye, Lock, Wrench } from 'lucide-react'
import { Markdown } from '@/components/ui/markdown'
import { Loader } from '@/components/ui/loader'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { clock } from '@/lib/format'
import type { PaseoAgent, PaseoItem } from '@/lib/types'
import { AGENT_STATE, AgentStateDot } from './AgentChip'
import { t } from '@/lib/i18n'
import { MediaImage } from '@/components/common/Media'

const REL_LABEL = { created: t('gestartet'), steers: t('gesteuert'), watches: t('beobachtet') } as const

/** "Paseo-Agents" tab of a session: list of linked agents, click opens a read-only transcript. */
export function PaseoPanel({ sessionId, version }: { sessionId: string; version: string }) {
  const [agents, setAgents] = useState<PaseoAgent[] | null>(null)
  const [connected, setConnected] = useState(true)
  const [source, setSource] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api<{ connected: boolean; source?: string | null; agents: PaseoAgent[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/paseo`)
      setAgents(r.agents)
      setConnected(r.connected)
      setSource(r.source ?? null)
    } catch { setAgents([]) }
  }, [sessionId])
  // `version` changes whenever the card's agent states change (pushed live), so the list follows.
  useEffect(() => { load() }, [load, version])
  useEffect(() => { setOpen(null) }, [sessionId])

  if (open) return <Transcript agentId={open} onBack={() => setOpen(null)} />
  if (!agents) return <div className="flex justify-center py-8"><Loader variant="dots" /></div>

  const active = agents.filter((a) => !a.archived)
  const archived = agents.filter((a) => a.archived)
  return (
    <div className="flex flex-col gap-3 p-4">
      {!connected && <p className="text-xs text-amber-600">{t('Paseo-Daemon nicht erreichbar – Status kann veraltet sein.')}</p>}
      {!agents.length && <p className="py-6 text-center text-sm text-muted-foreground">{t('Diese Session hat keine Paseo-Agents gestartet oder gesteuert.')}</p>}
      {active.map((a) => <AgentRow key={a.id} a={a} onOpen={() => setOpen(a.id)} />)}
      {archived.length > 0 && (
        <Collapsible open={showArchived} onOpenChange={setShowArchived}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {showArchived ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {archived.length} archiviert
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-2 opacity-60">
            {archived.map((a) => <AgentRow key={a.id} a={a} onOpen={() => setOpen(a.id)} />)}
          </CollapsibleContent>
        </Collapsible>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Lock className="size-3" />{t('Nur lesen – Agents werden von Hermes gesteuert.')}{source && <span className="ml-auto font-mono opacity-70">{source}</span>}</p>
    </div>
  )
}

function AgentRow({ a, onOpen }: { a: PaseoAgent; onOpen: () => void }) {
  const st = AGENT_STATE[a.state] || AGENT_STATE.unknown
  return (
    <button onClick={onOpen} className="group flex w-full flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-2">
        <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{a.title || a.id}</div>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-6 text-xs text-muted-foreground">
        <span className={cn('inline-flex items-center gap-1.5', st.text)}><AgentStateDot state={a.state} />{st.label}</span>
        <span>{REL_LABEL[a.rel]}</span>
        {a.account && <span>Account {a.account}</span>}
        {a.kind && <span>{a.kind}</span>}
        {a.updatedAt && <span>{clock(Date.parse(a.updatedAt) / 1000)}</span>}
      </div>
      {a.pendingPermissions && a.pendingPermissions.length > 0 && (
        <div className="ml-6 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
          Wartet auf Freigabe: {a.pendingPermissions.map((p) => p.title || p.name).join(', ')} – Hermes/Max entscheiden
        </div>
      )}
      {a.lastError && <div className="ml-6 text-xs text-red-600 dark:text-red-400">{a.lastError}</div>}
      {a.goal && a.goal !== a.title && <div className="ml-6 line-clamp-2 text-xs text-muted-foreground/80">Ziel: {a.goal}</div>}
    </button>
  )
}

function Transcript({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const [data, setData] = useState<{ agent: PaseoAgent; items: PaseoItem[]; hasOlder: boolean } | null>(null)
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(150)
  const load = useCallback(async () => {
    try {
      setData(await api(`/api/paseo/agents/${agentId}/timeline?limit=${limit}`))
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [agentId, limit])
  useEffect(() => { load() }, [load])
  // Live while the agent works: refetch the tail every 3 s.
  useEffect(() => {
    if (data?.agent.state !== 'running') return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [data?.agent.state, load])
  useEffect(() => { requestAnimationFrame(() => document.getElementById('paseo-end')?.scrollIntoView({ block: 'end' })) }, [data?.items.length])

  const a = data?.agent
  const st = a ? AGENT_STATE[a.state] || AGENT_STATE.unknown : null
  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />{t('Agents')}</button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{a?.title || agentId}</div>
        {st && a && <span className={cn('inline-flex items-center gap-1.5 text-xs', st.text)}><AgentStateDot state={a.state} />{st.label}</span>}
        {a?.deepLink && (
          <a href={a.deepLink} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title={t('In der Paseo-App öffnen')}>
            Paseo<ExternalLink className="size-3" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground"><Eye className="size-3" />Read-only Transkript{a?.state === 'running' && t(' · aktualisiert live')}</div>
      <div className="flex flex-col gap-3 p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <div className="flex justify-center py-8"><Loader variant="dots" /></div>}
        {data?.hasOlder && (
          <button className="self-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setLimit((l) => Math.min(400, l + 150))}>{t('Ältere Einträge laden')}</button>
        )}
        {data?.items.map((it, i) => <Item key={`${it.ts}-${i}`} it={it} />)}
        <div id="paseo-end" />
      </div>
    </div>
  )
}

function Images({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null
  return <div className="mt-2 flex flex-wrap gap-2">{urls.map((u) => <MediaImage key={u.slice(0, 120)} url={u} className="max-h-56" />)}</div>
}

function Item({ it }: { it: PaseoItem }) {
  const [open, setOpen] = useState(false)
  if (it.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm ring-1 ring-border/60">
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{it.text}</div>
          <Images urls={it.images} />
          <div className="mt-1 text-right text-[10.5px] text-muted-foreground">{clock(it.ts)}</div>
        </div>
      </div>
    )
  }
  if (it.role === 'assistant') {
    return (
      <div>
        <Markdown className="prose prose-sm prose-zinc max-w-none break-words text-foreground dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">{it.text || ''}</Markdown>
        <Images urls={it.images} />
      </div>
    )
  }
  if (it.role === 'tool') {
    return (
      <div className="text-xs">
        <button onClick={() => setOpen((o) => !o)} className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground hover:text-foreground', it.status === 'failed' && 'border-red-500/40 text-red-600 dark:text-red-400')}>
          <Wrench className="size-3 shrink-0" />
          <span className="font-mono">{it.toolName}</span>
          {it.summary && <span className="truncate opacity-80">· {it.summary}</span>}
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        </button>
        {open && it.text && <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted/60 p-2 font-mono text-[11.5px] ring-1 ring-border">{it.text}</pre>}
        <Images urls={it.images} />
      </div>
    )
  }
  if (it.role === 'todo') {
    return (
      <div className="rounded-md border px-3 py-2 text-xs">
        {it.todos?.map((t, i) => <div key={i} className={cn('flex gap-1.5', t.done && 'text-muted-foreground line-through')}>{t.done ? '☑' : '☐'} {t.text}</div>)}
      </div>
    )
  }
  return <div className={cn('rounded-md px-3 py-1.5 text-xs', it.role === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-muted text-muted-foreground')}>{it.text}</div>
}
