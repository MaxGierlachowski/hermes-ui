// State of the "Summary" pill above the composer (components/thread/SummaryPill.tsx) for one chat.
import { useEffect, useRef, useState } from 'react'
import { sendSummary, summaryPillState, type SummaryPhase } from '@/lib/summary'
import { haptic } from '@/lib/haptics'

export function useSummaryPill(sessionId: string, messages: number, running: boolean) {
  // Kept per chat: another chat starts at "idle" (the thread view stays mounted when switching).
  const [st, setSt] = useState<{ id: string; phase: SummaryPhase }>({ id: sessionId, phase: 'idle' })
  const ref = useRef<{ id: string; current: SummaryPhase }>({ id: sessionId, current: 'idle' })
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const phase = st.id === sessionId ? st.phase : 'idle'
  const state = summaryPillState({ messages, running, phase })
  const run = (send: (text: string) => Promise<unknown>) => {
    if (ref.current.id !== sessionId) ref.current = { id: sessionId, current: 'idle' }
    haptic()
    return sendSummary(ref.current, (p) => { if (alive.current) setSt({ id: sessionId, phase: p }) }, send)
  }
  return { state, run }
}
