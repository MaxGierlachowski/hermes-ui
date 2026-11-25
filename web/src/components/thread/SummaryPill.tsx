// "Summary": a floating pill right above the composer. A click sends SUMMARY_PROMPT (shared/summary.ts)
// into this chat through the composer's send path; hidden while the chat is empty or a turn runs.
// It floats over the bottom edge of the message list, which then gets extra bottom padding so every row
// can be scrolled out from under it (data-scroll-overlay tells the touch-target audit, e2e/targets.ts).
import { Check, ListChecks, Loader2 } from 'lucide-react'
import type { summaryPillState } from '@/lib/summary'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

export function SummaryPill({ state, onClick }: { state: ReturnType<typeof summaryPillState>; onClick: () => void }) {
  if (state === 'hidden') return null
  const busy = state !== 'ready'
  return (
    <div data-scroll-overlay className="pointer-events-none absolute inset-x-0 bottom-full mb-1.5 flex justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-busy={state === 'sending'}
            data-testid="summary-pill"
            className={cn(
              'touch-hitbox pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full border bg-card/95 px-3 text-[13px] font-medium shadow-sm backdrop-blur transition-colors dark:shadow-none touch:h-9',
              busy ? 'cursor-default' : 'hover:bg-muted',
            )}
          >
            {state === 'sending' ? <Loader2 className="size-3.5 animate-spin" /> : state === 'sent' ? <Check className="size-3.5 text-primary" /> : <ListChecks className="size-3.5 text-muted-foreground" />}
            {state === 'sending' ? t('Zusammenfassung wird angefordert …') : state === 'sent' ? t('Zusammenfassung angefordert') : t('Summary')}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('Zusammenfassung, Stand und offene Tasks')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
