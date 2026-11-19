// The "Summary" pill above a chat's composer (web UI and app). A click sends SUMMARY_PROMPT as an
// ordinary user message into that chat, through the composer's own send path; Hermes answers it like
// any other message. The prompt lives here only, so both frontends send the same text.

/** Asks Hermes for a summary, the state of things and every open task, in the chat's own language. */
export const SUMMARY_PROMPT = [
  'Please summarize this chat so far, in three short sections:',
  '1. Summary: what this chat is about and what it is meant to achieve.',
  '2. Current state: what has been decided or done so far, and why.',
  '3. Open tasks: list every task that is still open, each with what exactly is to be done, who has to do it, and what it is blocked by (if anything). Say so explicitly if nothing is open.',
  'Answer in the language this chat is mainly written in. Answer only from this chat: do not start any tools, agents or new work for it.',
].join('\n')

/** After a click: "sending" while the request runs, then "sent" for SUMMARY_SENT_MS as feedback. */
export const SUMMARY_SENT_MS = 2500

export type SummaryPhase = 'idle' | 'sending' | 'sent'

/**
 * hidden: nothing to summarize yet (no messages), or Hermes is working on a turn or waits for an
 * answer to an approval / question (`running` covers both; a summary would only queue behind it). disabled: a click is on its way or just went out (no double send).
 * Feedback wins over hidden: the "sent" state stays visible while the new turn starts.
 */
export function summaryPillState(s: { messages: number; running: boolean; phase: SummaryPhase }): 'hidden' | 'ready' | 'sending' | 'sent' {
  if (s.phase === 'sending') return 'sending'
  if (s.phase === 'sent') return 'sent'
  if (s.messages === 0 || s.running) return 'hidden'
  return 'ready'
}

/**
 * Runs one summary request: refuses while one is on its way or just went out (`phase` is a ref, so a
 * second click in the same frame is refused too), reports each phase and returns whether the message
 * went out. `send` is the composer's send function (false or a throw = not delivered; it reports the
 * reason itself).
 */
export async function sendSummary(
  phase: { current: SummaryPhase },
  setPhase: (p: SummaryPhase) => void,
  send: (text: string) => Promise<unknown>,
  later: (fn: () => void, ms: number) => unknown = setTimeout,
): Promise<boolean> {
  if (phase.current !== 'idle') return false
  const to = (p: SummaryPhase) => { phase.current = p; setPhase(p) }
  to('sending')
  let ok = false
  try { ok = (await send(SUMMARY_PROMPT)) !== false } catch { ok = false }
  if (!ok) { to('idle'); return false }
  to('sent')
  later(() => to('idle'), SUMMARY_SENT_MS)
  return true
}
