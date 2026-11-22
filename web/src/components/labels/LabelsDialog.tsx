import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Label } from '@/lib/types'
import { createLabel, deleteLabel, openLabelsDialog, updateLabel, useBoard } from '@/lib/store'
import { t } from '@/lib/i18n'
import { LabelDot } from './LabelChip'
import { LABEL_COLORS } from '@/lib/labels'

/** The managed set of labels: create, rename, recolor, delete (deleting removes it from every card). */
export function LabelsDialog() {
  const open = useBoard((s) => s.labelsDialog)
  const labels = useBoard((s) => s.labels)
  const sessions = useBoard((s) => s.sessions)
  const [name, setName] = useState('')
  const [color, setColor] = useState(LABEL_COLORS[0])
  useEffect(() => { if (open) { setName(''); setColor(LABEL_COLORS[labels.length % LABEL_COLORS.length]) } }, [open])
  const count = (id: string) => Object.values(sessions).filter((s) => s.labels?.includes(id)).length
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    // Cleared right away so the next name can be typed while this one is saved; back on failure.
    setName('')
    setColor(LABEL_COLORS[(labels.length + 1) % LABEL_COLORS.length])
    if (!(await createLabel(n, color))) setName((cur) => cur || n)
  }
  return (
    <Dialog open={open} onOpenChange={openLabelsDialog}>
      <DialogContent mobileSheet className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Labels')}</DialogTitle>
          <DialogDescription>{t('Karten mit Labels versehen und das Board danach filtern, z. B. nach Projekt.')}</DialogDescription>
        </DialogHeader>
        {labels.length > 0 && (
          <ul className="-mx-1 flex max-h-[45vh] flex-col gap-1 overflow-y-auto px-1" aria-label={t('Labels')}>
            {labels.map((l) => <LabelRow key={l.id} label={l} cards={count(l.id)} />)}
          </ul>
        )}
        <form onSubmit={add} className="flex items-center gap-2 border-t pt-3">
          <ColorPicker value={color} onChange={setColor} label={t('Farbe')} />
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('Neues Label, z. B. Projektname')} aria-label={t('Name des neuen Labels')} className="h-9" />
          <Button type="submit" size="sm" className="h-9 shrink-0" disabled={!name.trim()}><Plus className="size-4" />{t('Anlegen')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LabelRow({ label, cards }: { label: Label; cards: number }) {
  const [name, setName] = useState(label.name)
  useEffect(() => setName(label.name), [label.name])
  const commit = () => {
    const n = name.trim()
    if (!n) { setName(label.name); return }
    if (n !== label.name) updateLabel(label.id, { name: n }).then((ok) => { if (!ok) setName(label.name) })
  }
  const remove = () => {
    const question = cards === 1 ? t('Label „{name}“ löschen? Es wird von einer Karte entfernt.', { name: label.name }) : t('Label „{name}“ löschen? Es wird von {n} Karten entfernt.', { name: label.name, n: cards })
    if (cards && !confirm(question)) return
    deleteLabel(label.id)
  }
  return (
    <li className="flex items-center gap-2" data-testid="label-row">
      <ColorPicker value={label.color} onChange={(c) => updateLabel(label.id, { color: c })} label={t('Farbe von „{name}“', { name: label.name })} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') setName(label.name) }}
        maxLength={40}
        aria-label={t('Name von „{name}“', { name: label.name })}
        className="h-9"
      />
      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{cards === 1 ? t('1 Karte') : t('{n} Karten', { n: cards })}</span>
      <Button type="button" variant="ghost" size="icon-sm" onClick={remove} aria-label={t('„{name}“ löschen', { name: label.name })} className="shrink-0 text-muted-foreground hover:text-destructive">
        <Trash2 className="size-4" />
      </Button>
    </li>
  )
}

/** A color swatch that opens the presets (plus the system color picker for anything else). */
function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const pick = (c: string) => { onChange(c); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="touch-hitbox grid size-9 shrink-0 place-items-center rounded-lg border hover:bg-muted">
          <LabelDot color={value} className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === value}
              aria-label={c}
              onClick={() => pick(c)}
              className={cn('touch-hitbox grid size-8 place-items-center rounded-md hover:bg-muted', c === value && 'ring-2 ring-ring')}
            >
              <LabelDot color={c} className="size-5" />
            </button>
          ))}
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
          {t('Eigene Farbe')}
        </label>
      </PopoverContent>
    </Popover>
  )
}
