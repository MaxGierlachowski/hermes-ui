import { Check } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { COLUMNS, type Column } from '@/lib/types'
import { haptic } from '@/lib/haptics'
import { t } from '@/lib/i18n'
import { COLUMN_COLOR } from './status'

/**
 * Phones: choose a card's column from a bottom sheet (thumb reach, 52 px rows) instead of a small
 * dropdown. Opened from the thread header and by long-pressing a card on the board.
 */
export function ColumnSheet({ open, onOpenChange, title, current, onPick }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title?: string
  current: Column | 'auto'
  onPick: (c: Column | 'auto') => void
}) {
  const options: { id: Column | 'auto'; label: string }[] = [{ id: 'auto', label: t('Automatisch') }, ...COLUMNS]
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose showCloseButton={false} className="gap-0 rounded-t-2xl px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="px-3 pb-2 pt-1">
          <SheetTitle className="text-[15px] font-semibold">{t('Verschieben nach')}</SheetTitle>
          {title && <SheetDescription className="line-clamp-1 text-[13px] text-muted-foreground">{title}</SheetDescription>}
        </div>
        <div role="radiogroup" aria-label={t('Spalte')} className="flex flex-col">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={current === o.id}
              onClick={() => { haptic(); onPick(o.id); onOpenChange(false) }}
              className={cn('flex h-13 items-center gap-3 rounded-xl px-3 text-left text-base transition-colors active:bg-muted', current === o.id && 'font-medium')}
            >
              {o.id === 'auto' ? <span className="size-2.5 rounded-full ring-1 ring-muted-foreground/60" /> : <span className={cn('size-2.5 rounded-full', COLUMN_COLOR[o.id])} />}
              <span className="flex-1">{o.label}</span>
              {current === o.id && <Check className="size-5 text-primary" />}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
