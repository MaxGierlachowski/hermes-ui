import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { createChat } from '@/lib/store'
import { Composer } from '@/components/thread/Composer'
import { t } from '@/lib/i18n'

export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState(false)
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
            await createChat({ ...m, title: title.trim() || undefined, draft })
            setTitle('')
            setDraft(false)
            onOpenChange(false)
          }}
        />
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Switch id="draft" checked={draft} onCheckedChange={setDraft} />
            <Label htmlFor="draft" className="text-xs font-normal">{t('Nur anlegen (New Task, noch nicht starten)')}</Label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
