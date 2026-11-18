import { useEffect, useState } from 'react'
import { Check, CircleHelp, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { respond } from '@/lib/store'
import { stripRecommended } from '@/lib/format'
import type { PendingPrompt as P } from '@/lib/types'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

const APPROVAL_LABEL: Record<string, { label: string; hint: string }> = {
  once: { label: t('Einmal erlauben'), hint: t('nur diesen Befehl') },
  session: { label: t('Für diese Session'), hint: t('gleiche Befehle in dieser Session') },
  always: { label: t('Immer erlauben'), hint: t('dauerhaft auf die Allowlist') },
  deny: { label: t('Ablehnen'), hint: '' },
}

// Hermes gives up on an unanswered prompt (approval -> deny, clarify -> unanswered); show how long is left.
function Countdown({ p }: { p: P }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  if (!p.timeoutS) return null
  const left = Math.max(0, Math.round(p.at / 1000 + p.timeoutS - now / 1000))
  return <span className="ml-auto font-normal normal-case tabular-nums tracking-normal text-amber-700/80 dark:text-amber-300/80">{left > 0 ? `noch ${left}s` : 'abgelaufen?'}</span>
}

function Shell({ kind, p, children }: { kind: P['kind']; p: P; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/[0.06] p-3 text-sm dark:bg-amber-500/[0.08]">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        {kind === 'approval' ? <ShieldAlert className="size-3.5" /> : <CircleHelp className="size-3.5" />}
        {kind === 'approval' ? 'Freigabe nötig' : t('Rückfrage von Hermes')}
        <Countdown p={p} />
      </div>
      {children}
    </div>
  )
}

export function PendingPrompt({ sessionId, prompt }: { sessionId: string; prompt: P }) {
  return prompt.kind === 'approval' ? <Approval sessionId={sessionId} p={prompt} /> : <Clarify sessionId={sessionId} p={prompt} />
}

function Approval({ sessionId, p }: { sessionId: string; p: P }) {
  const [busy, setBusy] = useState<string | null>(null)
  const go = async (choice: string) => { haptic(); setBusy(choice); await respond(sessionId, { promptId: p.promptId, choice }); setBusy(null) }
  const allow = p.choices.filter((c) => c !== 'deny')
  return (
    <Shell kind="approval" p={p}>
      {p.description && <p className="mb-2 text-foreground">{p.description}</p>}
      {p.command && <pre className="mb-3 max-h-48 overflow-auto rounded-md bg-background/80 p-2 font-mono text-xs ring-1 ring-border">{p.command}</pre>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {allow.map((c, i) => (
          <Button key={c} size="sm" variant={i === 0 ? 'default' : 'outline'} disabled={!!busy} onClick={() => go(c)} title={APPROVAL_LABEL[c]?.hint} className="w-full sm:w-auto">
            <Check className="size-3.5" />{APPROVAL_LABEL[c]?.label || c}
          </Button>
        ))}
        {p.choices.includes('deny') && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => go('deny')} className="w-full text-destructive hover:text-destructive sm:ml-auto sm:w-auto">
            <X className="size-3.5" />{t('Ablehnen')}
          </Button>
        )}
      </div>
    </Shell>
  )
}

function Clarify({ sessionId, p }: { sessionId: string; p: P }) {
  const [picked, setPicked] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (body: { answer?: string; answers?: string[] }) => {
    haptic()
    setBusy(true)
    await respond(sessionId, { promptId: p.promptId, ...body })
    setBusy(false)
  }
  const choices = p.choices.map((c) => ({ raw: c, label: stripRecommended(c), recommended: c !== stripRecommended(c) }))
  return (
    <Shell kind="clarify" p={p}>
      <p className="mb-3 whitespace-pre-wrap text-foreground">{p.question}</p>
      {choices.length > 0 && (p.multiSelect ? (
        <div className="mb-3 flex flex-col gap-1.5">
          {choices.map((c) => (
            <label key={c.raw} className={cn('flex cursor-pointer items-center gap-2 rounded-md border bg-background/70 px-2.5 py-2 text-sm transition-colors hover:bg-background touch:min-h-11 touch:gap-3', picked.includes(c.label) && 'border-primary/60')}>
              <Checkbox checked={picked.includes(c.label)} onCheckedChange={(v) => setPicked((x) => (v ? [...x, c.label] : x.filter((y) => y !== c.label)))} />
              {c.label}
              {c.recommended && <span className="ml-auto text-[11px] text-muted-foreground">{t('empfohlen')}</span>}
            </label>
          ))}
          <Button size="sm" className="mt-1 self-start" disabled={busy || !picked.length} onClick={() => send({ answers: picked })}>
            {picked.length} Auswahl senden
          </Button>
        </div>
      ) : (
        <div className="mb-3 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
          {choices.map((c) => (
            <Button key={c.raw} size="sm" variant={c.recommended ? 'default' : 'outline'} disabled={busy} onClick={() => send({ answer: c.label })} className="w-full justify-start sm:w-auto">
              {c.label}
            </Button>
          ))}
        </div>
      ))}
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) send({ answer: text.trim() }) }}
          placeholder={choices.length ? 'Oder frei antworten …' : t('Antwort …')}
          className="min-h-9 resize-none bg-background/80 text-sm"
          rows={1}
        />
        <Button size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={() => send({ answer: text.trim() })}>{t('Senden')}</Button>
      </div>
      <button className="touch-hitbox mt-2 text-xs text-muted-foreground hover:text-foreground touch:text-[13px]" disabled={busy} onClick={() => send({ answer: '' })}>{t('Überspringen')}</button>
    </Shell>
  )
}
