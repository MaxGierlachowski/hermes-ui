import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { clearConfirm, respond, useBoard } from '@/lib/store'
import { t } from '@/lib/i18n'

// "Allow …" / "Deny …" on a notification opens the app with this dialog: nothing is answered
// before the user confirms here, with the command in front of them.
export function ConfirmApproval() {
  const confirm = useBoard((s) => s.confirm)
  const open = useBoard((s) => s.inbox.open)
  const [busy, setBusy] = useState(false)
  const item = confirm && open.find((o) => o.source === 'hermes' && o.prompt.promptId === confirm.promptId)
  const prompt = item && item.source === 'hermes' ? item.prompt : null
  const deny = confirm?.choice === 'deny'
  const go = async () => {
    if (!confirm) return
    setBusy(true)
    const ok = await respond(confirm.sessionId, { promptId: confirm.promptId, choice: confirm.choice })
    setBusy(false)
    if (ok) clearConfirm()
  }
  return (
    <Dialog open={!!confirm} onOpenChange={(o) => !o && clearConfirm()}>
      <DialogContent mobileSheet className="grid-cols-1 sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{deny ? t('Freigabe ablehnen?') : t('Freigabe erteilen?')}</DialogTitle>
          <DialogDescription>{item ? item.title : t('Diese Anfrage ist nicht mehr offen.')}</DialogDescription>
        </DialogHeader>
        {prompt && (
          <div className="space-y-2 text-sm">
            {prompt.description && <p>{prompt.description}</p>}
            {prompt.command && <pre className="max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted p-2 font-mono text-xs">{prompt.command}</pre>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={clearConfirm}>{t('Abbrechen')}</Button>
          {prompt && (
            <Button variant={deny ? 'destructive' : 'default'} disabled={busy} onClick={go}>
              {deny ? <X className="size-4" /> : <Check className="size-4" />}{deny ? t('Ablehnen') : t('Erlauben')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
