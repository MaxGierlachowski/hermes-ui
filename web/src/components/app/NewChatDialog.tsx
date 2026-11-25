import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createChat, modelOptions } from '@/lib/store'
import type { ModelChoice, ModelOptions } from '@/lib/types'
import { Composer } from '@/components/thread/Composer'
import { t } from '@/lib/i18n'

// "default" = send no model, so the gateway's own default applies; other values encode one provider/model pair.
const DEFAULT_MODEL = 'default'
const encodeChoice = (choice: ModelChoice) => JSON.stringify([choice.provider, choice.model])
const decodeChoice = (value: string): ModelChoice | undefined => {
  if (value === DEFAULT_MODEL) return undefined
  const [provider, model] = JSON.parse(value) as [string, string]
  return { provider, model }
}

// The last answer, so reopening the dialog shows the picker at once while a fresh list loads.
let cachedOptions: ModelOptions | null = null

function useModelOptions(open: boolean) {
  const [options, setOptions] = useState(cachedOptions)
  useEffect(() => {
    if (!open) return
    let active = true
    modelOptions()
      .then((loaded) => { cachedOptions = loaded; if (active) setOptions(loaded) })
      .catch(() => { /* gateway offline or older backend: no picker, chats use the gateway default */ })
    return () => { active = false }
  }, [open])
  return options?.providers?.length ? options : null
}

function ModelPicker({ options, value, onChange }: { options: ModelOptions; value: string; onChange: (value: string) => void }) {
  const grouped = options.providers.length > 1
  return (
    // No visible label: the trigger shows the model, which is clear enough. Full width in the phone sheet, like the inputs.
    <div className="w-full sm:w-auto">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="model" size="sm" aria-label={t('Modell')} className="h-8 w-full text-xs sm:w-auto sm:max-w-[240px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_MODEL}>
            {options.current ? t('Standard ({model})', { model: options.current.model }) : t('Standard')}
          </SelectItem>
          {options.providers.map((provider) => (
            <SelectGroup key={provider.slug}>
              {grouped && <SelectLabel>{provider.name}</SelectLabel>}
              {provider.models.map((model) => (
                <SelectItem key={model} value={encodeChoice({ provider: provider.slug, model })}>{model}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const options = useModelOptions(open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Neuer Chat')}</DialogTitle>
          <DialogDescription>{t('Text, Bilder oder eine Sprachnachricht an Hermes.')}</DialogDescription>
        </DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Titel (optional)')} className="h-9" />
        <Composer
          autoFocus
          placeholder={t('Was soll Hermes tun?')}
          onSubmit={async (m) => {
            await createChat({ ...m, title: title.trim() || undefined, draft, ...decodeChoice(model) })
            setTitle('')
            setDraft(false)
            setModel(DEFAULT_MODEL)
            onOpenChange(false)
          }}
        />
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {options && <ModelPicker options={options} value={model} onChange={setModel} />}
          <div className="flex items-center gap-1.5">
            <Switch id="draft" checked={draft} onCheckedChange={setDraft} />
            <Label htmlFor="draft" className="text-xs font-normal">{t('Nur anlegen (New Task, noch nicht starten)')}</Label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
