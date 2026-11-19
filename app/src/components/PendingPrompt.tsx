import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Check, CircleHelp, ShieldAlert, Square, SquareCheck, X } from 'lucide-react-native'
import type { PendingPrompt as P } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { respond } from '@/lib/store'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'
import { isWebDesktop } from '@/lib/web-input'
import { BUTTON_ICON } from '@/components/ui/button'

const D = isWebDesktop
const SIZE = D ? 'sm' : 'default'
const BODY = D ? 'text-sm' : 'text-[15px]'

const stripRecommended = (c: string) => c.replace(/\s*\((recommended|empfohlen)\)\s*$/i, '').trim()
const APPROVAL_LABEL: Record<string, string> = { once: t('Einmal erlauben'), session: t('Für diese Session'), always: t('Immer erlauben'), deny: t('Ablehnen') }

function Countdown({ p }: { p: P }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  if (!p.timeoutS) return null
  const left = Math.max(0, Math.round(p.at / 1000 + p.timeoutS - now / 1000))
  return <Text className="ml-auto text-xs text-amber-700/80 dark:text-amber-300/80">{left > 0 ? `${left}s` : '–'}</Text>
}

function Shell({ p, children }: { p: P; children: React.ReactNode }) {
  return (
    <View className={cn('rounded-lg border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/5 p-3', D ? 'gap-2.5' : 'gap-3')}>
      <View className="flex-row items-center gap-1.5">
        <Icon as={p.kind === 'approval' ? ShieldAlert : CircleHelp} size={14} color="#d97706" />
        <Text className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{p.kind === 'approval' ? t('Freigabe nötig') : t('Rückfrage von Hermes')}</Text>
        <Countdown p={p} />
      </View>
      {children}
    </View>
  )
}

/** An open Hermes approval or clarify prompt, answerable in place (thread and inbox). */
export function PendingPrompt({ sessionId, prompt: p }: { sessionId: string; prompt: P }) {
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const send = async (body: { choice?: string; answer?: string; answers?: string[] }) => {
    haptic('success'); setBusy(true)
    await respond(sessionId, { promptId: p.promptId, ...body })
    setBusy(false)
  }
  if (p.kind === 'approval') {
    return (
      <Shell p={p}>
        {!!p.description && <Text className={BODY}>{p.description}</Text>}
        {!!p.command && <Text selectable className="rounded-md border border-border bg-background/80 p-2 font-mono text-xs">{p.command}</Text>}
        {/* Desktop: the buttons in one row like the web UI; phone: stacked full-width touch targets. */}
        <View className={isWebDesktop ? 'flex-row flex-wrap items-center gap-2' : 'gap-3'}>
          {p.choices.filter((c) => c !== 'deny').map((c, i) => (
            <Button key={c} size={SIZE} variant={i === 0 ? 'default' : 'outline'} disabled={busy} onPress={() => send({ choice: c })}>
              <Icon as={Check} size={BUTTON_ICON - 2} tone={i === 0 ? 'primary-foreground' : 'foreground'} /><Text>{APPROVAL_LABEL[c] || c}</Text>
            </Button>
          ))}
          {p.choices.includes('deny') && (
            <Button size={SIZE} variant="ghost" className={isWebDesktop ? 'ml-auto' : undefined} disabled={busy} onPress={() => send({ choice: 'deny' })}>
              <Icon as={X} size={BUTTON_ICON - 2} tone="destructive" /><Text className="text-destructive">{t('Ablehnen')}</Text>
            </Button>
          )}
        </View>
      </Shell>
    )
  }
  const choices = p.choices.map((c) => ({ raw: c, label: stripRecommended(c), recommended: c !== stripRecommended(c) }))
  return (
    <Shell p={p}>
      <Text selectable className={BODY}>{p.question}</Text>
      {choices.length > 0 && (p.multiSelect ? (
        <View className="gap-1.5">
          {choices.map((c) => {
            const on = picked.includes(c.label)
            return (
              <Pressable key={c.raw} onPress={() => { haptic('select'); setPicked((x) => (on ? x.filter((y) => y !== c.label) : [...x, c.label])) }} className={cn('flex-row items-center rounded-md border border-border bg-background/70 web:hover:bg-background', D ? 'gap-2 px-2.5 py-2' : 'min-h-12 gap-3 px-3', on && 'border-primary/60')}>
                <Icon as={on ? SquareCheck : Square} size={D ? 16 : 18} tone={on ? 'primary' : 'muted-foreground'} />
                <Text className={cn('flex-1', D && 'text-sm')}>{c.label}</Text>
                {c.recommended && <Text className="text-[11px] text-muted-foreground">{t('empfohlen')}</Text>}
              </Pressable>
            )
          })}
          <Button size={SIZE} className={D ? 'mt-1 self-start' : undefined} disabled={busy || !picked.length} onPress={() => send({ answers: picked })}><Text>{t('Auswahl senden ({n})', { n: picked.length })}</Text></Button>
        </View>
      ) : (
        // Desktop: the answers as a row of small buttons like the web UI; phones: stacked touch targets.
        <View className={D ? 'flex-row flex-wrap gap-1.5' : 'gap-2'}>
          {choices.map((c) => (
            <Button key={c.raw} size={SIZE} variant={c.recommended ? 'default' : 'outline'} disabled={busy} className={D ? undefined : 'justify-start'} onPress={() => send({ answer: c.label })}><Text>{c.label}</Text></Button>
          ))}
        </View>
      ))}
      <View className="flex-row items-center gap-2">
        <Input className="flex-1" value={text} onChangeText={setText} placeholder={choices.length ? t('Oder frei antworten …') : t('Antwort …')} editable={!busy} onSubmitEditing={() => text.trim() && send({ answer: text.trim() })} />
        <Button size={D ? 'default' : undefined} variant="secondary" disabled={busy || !text.trim()} onPress={() => send({ answer: text.trim() })}><Text>{t('Senden')}</Text></Button>
      </View>
      <Pressable className={cn('self-start', D ? 'py-0.5' : 'min-h-11 justify-center')} disabled={busy} onPress={() => send({ answer: '' })} accessibilityRole="button">
        <Text className={cn('text-muted-foreground web:hover:text-foreground', D ? 'text-xs' : 'text-sm')}>{t('Überspringen')}</Text>
      </Pressable>
    </Shell>
  )
}
