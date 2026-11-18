import { useEffect, useState } from 'react'
import { BellOff, BellRing, Send, Share } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { disablePush, enablePush, isIOS, isStandalone, refreshPush, savePushSettings, testPush, usePush } from '@/lib/push'
import type { PushSettings } from '@/lib/types'
import { t } from '@/lib/i18n'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function Row({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 touch:min-h-11 touch:items-center">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

export function NotificationSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const push = usePush()
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) refreshPush() }, [open])
  const s = push.settings
  const save = (patch: Partial<PushSettings>) => savePushSettings(patch).catch((err) => toast.error(errText(err)))
  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try { await fn(); if (ok) toast.success(ok) } catch (err) {
      const m = errText(err)
      toast.error(m === 'denied' ? t('Benachrichtigungen sind für diese Seite blockiert. In den Browser- bzw. iOS-Einstellungen erlauben.') : m === 'dismissed' ? t('Keine Erlaubnis erteilt.') : m)
    } finally { setBusy(false) }
  }
  const on = push.status === 'on'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="grid-cols-1 sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t('Benachrichtigungen')}</DialogTitle>
          <DialogDescription>{t('Push-Benachrichtigungen auf diesem Gerät, wenn eine Freigabe nötig ist oder ein Chat fertig wird. Sie enthalten nur den Chat-Titel und die Art, keine Inhalte.')}</DialogDescription>
        </DialogHeader>

        {push.status === 'needs-install' || (isIOS && !isStandalone() && push.status !== 'on') ? (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><Share className="size-4" />{t('Erst zum Home-Bildschirm hinzufügen')}</p>
            <p className="text-muted-foreground">{t('Auf iPhone und iPad gibt es Push nur in der installierten App (iOS 16.4 oder neuer): in Safari Teilen → „Zum Home-Bildschirm“, die App von dort öffnen und hier „Benachrichtigungen aktivieren“ tippen.')}</p>
          </div>
        ) : push.status === 'unsupported' ? (
          <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{t('Dieser Browser unterstützt keine Push-Benachrichtigungen (oder kein Service Worker, z. B. im privaten Modus).')}</p>
        ) : push.status === 'disabled' ? (
          <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{t('Push ist im Backend ausgeschaltet (HERMES_UI_PUSH=off).')}</p>
        ) : push.status === 'denied' ? (
          <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{t('Benachrichtigungen sind für diese Seite blockiert. In den Browser- bzw. iOS-Einstellungen erlauben.')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {on ? (
              <>
                <span className="flex items-center gap-1.5 text-sm"><span className="size-2 rounded-full bg-emerald-500" />{t('Aktiv auf diesem Gerät')}</span>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(testPush, t('Test gesendet'))}><Send className="size-3.5" />{t('Test')}</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(disablePush)}><BellOff className="size-3.5" />{t('Aus')}</Button>
                </div>
              </>
            ) : (
              <Button disabled={busy || push.status === 'unknown'} onClick={() => run(() => enablePush(), t('Benachrichtigungen aktiviert'))} className="w-full">
                <BellRing className="size-4" />{t('Benachrichtigungen aktivieren')}
              </Button>
            )}
          </div>
        )}

        <Separator />
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('Was soll pushen?')}</p>
          <Row id="p-approval" label={t('Freigaben und Rückfragen')} checked={s.approval} onChange={(v) => save({ approval: v })} />
          <Row id="p-done" label={t('Fertig')} hint={t('Hermes-Chat fertig (und seine Paseo-Agents), Paseo-Agent fertig')} checked={s.done} onChange={(v) => save({ done: v })} />
          <Row id="p-error" label={t('Fehler und Limits')} checked={s.error} onChange={(v) => save({ error: v })} />
          <Row id="p-paseo" label={t('Paseo-Agents einbeziehen')} checked={s.paseo} onChange={(v) => save({ paseo: v })} />
          <Row id="p-visible" label={t('Nicht pushen, wenn die App offen und sichtbar ist')} hint={t('Dann erscheint nur der Hinweis in der App.')} checked={s.skipWhenVisible} onChange={(v) => save({ skipWhenVisible: v })} />
          <Row id="p-quiet" label={t('Ruhezeiten')} checked={s.quiet.enabled} onChange={(v) => save({ quiet: { ...s.quiet, enabled: v } })} />
          {s.quiet.enabled && (
            <div className="flex items-center gap-2 pl-0.5 text-sm">
              <span className="text-muted-foreground">{t('von')}</span>
              <Input type="time" value={s.quiet.from} onChange={(e) => save({ quiet: { ...s.quiet, from: e.target.value } })} className="h-8 w-28" />
              <span className="text-muted-foreground">{t('bis')}</span>
              <Input type="time" value={s.quiet.to} onChange={(e) => save({ quiet: { ...s.quiet, to: e.target.value } })} className="h-8 w-28" />
            </div>
          )}
          {!on && <p className="text-xs text-muted-foreground">{t('Die Auswahl gilt, sobald Benachrichtigungen aktiv sind.')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
