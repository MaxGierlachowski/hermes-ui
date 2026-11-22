import { useState } from 'react'
import { Check, Settings2, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Session } from '@/lib/types'
import { openLabelsDialog, setCardLabels, useBoard } from '@/lib/store'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'
import { useIsMobile } from '@/hooks/use-mobile'
import { LabelDot } from './LabelChip'

/**
 * Assign labels to a card, from the thread header: a popover on a desktop, a bottom sheet on a phone.
 * Each label is a toggle; changes apply at once. Hidden until the first label exists.
 */
export function LabelPicker({ session }: { session: Session }) {
  const labels = useBoard((s) => s.labels)
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  if (!labels.length) return null
  const mine = session.labels || []
  const toggle = (id: string) => {
    haptic(5)
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]
    setCardLabels(session.id, labels.map((l) => l.id).filter((x) => next.includes(x)))
  }
  const manage = () => { setOpen(false); openLabelsDialog() }
  const list = (
    <div role="group" aria-label={t('Labels')} className="flex flex-col">
      {labels.map((l) => {
        const on = mine.includes(l.id)
        return (
          <button
            key={l.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(l.id)}
            className={cn('flex items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-muted', isMobile ? 'h-13 rounded-xl px-3 text-base active:bg-muted' : 'h-8 text-sm')}
          >
            <LabelDot color={l.color} className={isMobile ? 'size-3' : undefined} />
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            {on && <Check className={cn('shrink-0 text-primary', isMobile ? 'size-5' : 'size-4')} />}
          </button>
        )
      })}
      <button
        type="button"
        onClick={manage}
        className={cn('mt-1 flex items-center gap-2.5 border-t px-2 pt-1 text-left text-muted-foreground transition-colors hover:text-foreground', isMobile ? 'h-13 px-3 text-base' : 'h-8 text-sm')}
      >
        <Settings2 className="size-4" />{t('Labels verwalten …')}
      </button>
    </div>
  )
  const trigger = (
    <Button variant="ghost" size="icon-sm" aria-label={t('Labels')} aria-haspopup="dialog" onClick={isMobile ? () => setOpen(true) : undefined}>
      <Tag className="size-4" />
    </Button>
  )
  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" swipeToClose showCloseButton={false} className="gap-0 rounded-t-2xl px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="px-3 pb-2 pt-1">
              <SheetTitle className="text-[15px] font-semibold">{t('Labels')}</SheetTitle>
              <SheetDescription className="line-clamp-1 text-[13px] text-muted-foreground">{session.title}</SheetDescription>
            </div>
            {list}
          </SheetContent>
        </Sheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('Labels')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-60 gap-1 p-1.5">
        {list}
      </PopoverContent>
    </Popover>
  )
}
