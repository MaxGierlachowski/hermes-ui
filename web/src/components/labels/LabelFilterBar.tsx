import { Settings2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { openLabelsDialog, setLabelFilter, toggleLabelFilter, useBoard } from '@/lib/store'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'
import { LabelDot } from './LabelChip'

/**
 * Filter the board by label: one toggle per label, a card shows when it has any selected label.
 * Only rendered once labels exist, so a board without labels looks exactly as before.
 */
export function LabelFilterBar({ mobile }: { mobile?: boolean }) {
  const labels = useBoard((s) => s.labels)
  const filter = useBoard((s) => s.labelFilter)
  if (!labels.length) return null
  return (
    <div
      role="toolbar"
      aria-label={t('Nach Label filtern')}
      className={cn('flex shrink-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]', mobile ? 'border-b px-2 py-1.5' : 'px-3 pt-3 -mb-1.5')}
    >
      {labels.map((l) => {
        const on = filter.includes(l.id)
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            data-testid="label-filter"
            onClick={() => { haptic(5); toggleLabelFilter(l.id) }}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
              mobile ? 'h-11 px-3.5 text-[13px]' : 'h-7',
              on && 'text-foreground',
            )}
            style={on ? { backgroundColor: `${l.color}26`, borderColor: l.color } : undefined}
          >
            <LabelDot color={l.color} />
            <span className="max-w-40 truncate">{l.name}</span>
          </button>
        )
      })}
      {filter.length > 0 && (
        <button
          type="button"
          onClick={() => setLabelFilter([])}
          className={cn('touch-hitbox inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground', mobile ? 'h-11 text-[13px]' : 'h-7')}
        >
          <X className="size-3.5" />{t('Alle zeigen')}
        </button>
      )}
      <button
        type="button"
        onClick={() => openLabelsDialog()}
        aria-label={t('Labels verwalten')}
        title={t('Labels verwalten')}
        className={cn('touch-hitbox ml-auto inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground', mobile ? 'size-11' : 'size-7')}
      >
        <Settings2 className="size-4" />
      </button>
    </div>
  )
}
