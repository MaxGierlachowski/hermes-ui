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
    <View className="gap-3 rounded-xl border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/5 p-3">
      <View className="flex-row items-center gap-1.5">
        <Icon as={p.kind === 'approval' ? ShieldAlert : CircleHelp} size={15} color="#d97706" />
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
        {!!p.description && <Text className="text-[15px]">{p.description}</Text>}
        {!!p.command && <Text selectable className="rounded-md bg-background/80 p-2 font-mono text-xs">{p.command}</Text>}
        {p.choices.filter((c) => c !== 'deny').map((c, i) => (
          <Button key={c} variant={i === 0 ? 'default' : 'outline'} disabled={busy} onPress={() => send({ choice: c })}>
            <Icon as={Check} size={16} tone={i === 0 ? 'primary-foreground' : 'foreground'} /><Text>{APPROVAL_LABEL[c] || c}</Text>
          </Button>
        ))}
        {p.choices.includes('deny') && (
          <Button variant="ghost" disabled={busy} onPress={() => send({ choice: 'deny' })}>
            <Icon as={X} size={16} tone="destructive" /><Text className="text-destructive">{t('Ablehnen')}</Text>
          </Button>
        )}
      </Shell>
    )
  }
  const choices = p.choices.map((c) => ({ raw: c, label: stripRecommended(c), recommended: c !== stripRecommended(c) }))
  return (
    <Shell p={p}>
      <Text selectable className="text-[15px]">{p.question}</Text>
      {choices.length > 0 && (p.multiSelect ? (
        <View className="gap-1.5">
          {choices.map((c) => {
            const on = picked.includes(c.label)
            return (
              <Pressable key={c.raw} onPress={() => { haptic('select'); setPicked((x) => (on ? x.filter((y) => y !== c.label) : [...x, c.label])) }} className={cn('min-h-12 flex-row items-center gap-3 rounded-lg border border-border bg-background/70 px-3', on && 'border-primary/60')}>
                <Icon as={on ? SquareCheck : Square} size={18} tone={on ? 'primary' : 'muted-foreground'} />
                <Text className="flex-1">{c.label}</Text>
                {c.recommended && <Text className="text-[11px] text-muted-foreground">{t('empfohlen')}</Text>}
              </Pressable>
            )
          })}
          <Button disabled={busy || !picked.length} onPress={() => send({ answers: picked })}><Text>{t('Auswahl senden ({n})', { n: picked.length })}</Text></Button>
        </View>
      ) : choices.map((c) => (
        <Button key={c.raw} variant={c.recommended ? 'default' : 'outline'} disabled={busy} className="justify-start" onPress={() => send({ answer: c.label })}><Text>{c.label}</Text></Button>
      )))}
      <View className="flex-row items-center gap-2">
        <Input className="flex-1" value={text} onChangeText={setText} placeholder={t('Antwort …')} editable={!busy} onSubmitEditing={() => text.trim() && send({ answer: text.trim() })} />
        <Button variant="secondary" disabled={busy || !text.trim()} onPress={() => send({ answer: text.trim() })}><Text>{t('Senden')}</Text></Button>
      </View>
      <Button variant="ghost" size="sm" className="self-start" disabled={busy} onPress={() => send({ answer: '' })}><Text className="text-sm text-muted-foreground">{t('Überspringen')}</Text></Button>
    </Shell>
  )
}
