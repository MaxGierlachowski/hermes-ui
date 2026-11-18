import { CircleHelp, FlaskConical, MessageSquare, Pin, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { relTime, clock } from '@/lib/format'
import type { Session } from '@/lib/types'
import { SourceIcon, StatusDot } from './status'
import { AgentChip } from '@/components/paseo/AgentChip'
import { t } from '@/lib/i18n'

export function SessionCard({ s, selected, flash, overlay }: { s: Session; selected?: boolean; flash?: boolean; overlay?: boolean }) {
  const pending = s.pending?.[0]
  return (
    <div
      className={cn(
        'group/card relative flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-[border-color,box-shadow,transform] duration-150 motion-reduce:transition-none',
        'hover:border-foreground/20 hover:shadow-sm dark:hover:shadow-none',
        selected && 'border-primary/70 ring-2 ring-primary/15',
        flash && 'animate-in fade-in-0 zoom-in-[0.98] duration-500',
        overlay && 'rotate-[1.5deg] cursor-grabbing shadow-lg',
        pending && 'border-l-2 border-l-amber-500',
      )}
    >
      <div className="flex items-start gap-2">
        <StatusDot column={s.column} running={s.running} pending={!!pending} className="mt-1.5" />
        <div className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">{s.title || 'Ohne Titel'}</div>
      </div>

      {pending ? (
        <div className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          {pending.kind === 'approval' ? <ShieldAlert className="mt-px size-3.5 shrink-0" /> : <CircleHelp className="mt-px size-3.5 shrink-0" />}
          <span className="line-clamp-2">
            {pending.kind === 'approval' ? 'Freigabe: ' : t('Rückfrage: ')}
            {pending.kind === 'approval' ? pending.description || pending.command : pending.question}
          </span>
        </div>
      ) : s.activity ? (
        <div className={cn('line-clamp-2 text-xs text-muted-foreground', s.running && 'text-foreground/80')}>{s.activity.replace(/^💬\s*/, '')}</div>
      ) : null}

      {s.paseo?.length > 0 && <PaseoChips s={s} />}

      {s.initialPrompt && s.initialPrompt !== s.title && !pending && (
        <div className="line-clamp-1 text-[11.5px] text-muted-foreground/70">„{s.initialPrompt}“</div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><SourceIcon source={s.source} className="size-3" />{s.source}</span>
        {s.test && <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><FlaskConical className="size-3" />Test</span>}
        {s.draft && <span className="rounded border px-1 text-[10px] uppercase tracking-wide touch:text-[11px]">{t('Entwurf')}</span>}
        {s.override && <Pin className="size-3 text-primary" aria-label={t('Manuell verschoben')} />}
        <span className="ml-auto inline-flex items-center gap-2">
          {s.messageCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{s.messageCount}</span>}
          <time title={clock(s.updatedAt)}>{relTime(s.updatedAt)}</time>
        </span>
      </div>
    </div>
  )
}

// Active agents as chips (max 3), archived ones only counted.
function PaseoChips({ s }: { s: Session }) {
  const active = s.paseo.filter((a) => !a.archived && a.rel !== 'watches')
  const archived = s.paseo.filter((a) => a.archived).length
  if (!active.length && !archived) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {active.slice(0, 3).map((a) => <AgentChip key={a.id} a={a} />)}
      {active.length > 3 && <span className="text-[11px] text-muted-foreground">+{active.length - 3}</span>}
      {archived > 0 && <span className="text-[11px] text-muted-foreground/60">{archived} archiviert</span>}
    </div>
  )
}
