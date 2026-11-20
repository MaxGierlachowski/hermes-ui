// "Summary": a floating pill at the bottom of the message list, right above the composer. A click sends
// SUMMARY_PROMPT (shared/summary.ts) into this chat through the composer's send path; hidden while the
// chat is empty or a turn runs.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useColorScheme } from 'nativewind'
import { Check, ListChecks } from 'lucide-react-native'
import { sendSummary, summaryPillState, type SummaryPhase } from '@shared/summary'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { haptic } from '@/lib/haptics'
import { shadow } from '@/lib/shadow'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

/** Gap between the pill and the composer below it. */
const SUMMARY_PILL_GAP = 6
/** Height the pill takes above the composer: the thread list keeps this much room below its newest row. */
export const SUMMARY_PILL_SPACE = 44

export function useSummaryPill(sessionId: string, messages: number, running: boolean) {
  // Kept per chat: another chat starts at "idle" (the pane stays mounted on the desktop split).
  const [st, setSt] = useState<{ id: string; phase: SummaryPhase }>({ id: sessionId, phase: 'idle' })
  const ref = useRef<{ id: string; current: SummaryPhase }>({ id: sessionId, current: 'idle' })
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const phase = st.id === sessionId ? st.phase : 'idle'
  const state = summaryPillState({ messages, running, phase })
  const run = (send: (text: string) => Promise<unknown>) => {
    if (ref.current.id !== sessionId) ref.current = { id: sessionId, current: 'idle' }
    haptic('select')
    return sendSummary(ref.current, (p) => { if (alive.current) setSt({ id: sessionId, phase: p }) }, send)
  }
  return { state, run }
}

export function SummaryPill({ state, onPress }: { state: ReturnType<typeof summaryPillState>; onPress: () => void }) {
  const { colorScheme } = useColorScheme()
  if (state === 'hidden') return null
  const busy = state !== 'ready'
  return (
    // box-none: only the pill takes clicks, the row around it lets them through to the messages.
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 items-center" style={{ paddingBottom: SUMMARY_PILL_GAP }}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('Summary')}
        accessibilityState={{ disabled: busy, busy: state === 'sending' }}
        className={cn('h-8 flex-row items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 web:backdrop-blur web:transition-colors', !busy && 'active:bg-accent web:hover:bg-muted')}
        style={shadow('sm', colorScheme === 'dark')}
        {...({ dataSet: { tip: t('Zusammenfassung, Stand und offene Tasks'), testid: 'summary-pill' } } as object)}
      >
        {state === 'sending' ? <ActivityIndicator size="small" /> : <Icon as={state === 'sent' ? Check : ListChecks} size={14} tone={state === 'sent' ? 'primary' : 'muted-foreground'} />}
        <Text className="text-[13px] font-medium">
          {state === 'sending' ? t('Zusammenfassung wird angefordert …') : state === 'sent' ? t('Zusammenfassung angefordert') : t('Summary')}
        </Text>
      </Pressable>
    </View>
  )
}
