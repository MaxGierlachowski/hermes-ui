import { cn } from '@/lib/utils'
import type { Label } from '@/lib/types'
import { useBoard } from '@/lib/store'

/** A label as a small pill: colored dot, name in the text color, a tint of the label color behind it. */
export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      data-testid="label-chip"
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium leading-4 text-foreground/85', className)}
      style={{ backgroundColor: `${label.color}1f`, borderColor: `${label.color}59` }}
    >
      <LabelDot color={label.color} />
      <span className="truncate">{label.name}</span>
    </span>
  )
}

export const LabelDot = ({ color, className }: { color: string; className?: string }) => (
  <span aria-hidden className={cn('size-2 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />
)

/** The labels of a card that still exist, in the order of the managed list. */
function useCardLabels(ids: string[] | undefined): Label[] {
  const labels = useBoard((s) => s.labels)
  if (!ids?.length) return []
  return labels.filter((l) => ids.includes(l.id))
}

export function CardLabels({ ids, className }: { ids: string[] | undefined; className?: string }) {
  const labels = useCardLabels(ids)
  if (!labels.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} aria-label="Labels">
      {labels.map((l) => <LabelChip key={l.id} label={l} />)}
    </div>
  )
}
