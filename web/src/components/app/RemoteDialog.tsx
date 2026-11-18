import { useEffect, useState } from 'react'
import { Copy, ExternalLink, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api'
import { loadRemote, logout, revokeDevice, useBoard } from '@/lib/store'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

const STATUS: Record<string, string> = {
  off: t('Aus (HERMES_UI_REMOTE=off)'),
  starting: t('Startet …'),
  online: t('Online'),
  reconnecting: t('Verbindet neu …'),
  'needs-login': t('Tailscale-Login nötig'),
  'needs-approval': t('Einmalige Freigabe im Tailscale-Admin nötig'),
  error: t('Fehler'),
}

export function RemoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const remote = useBoard((s) => s.remote)
  const devices = useBoard((s) => s.devices)
  const isLocal = useBoard((s) => s.isLocal)
  const [pair, setPair] = useState<{ link: string; svg: string; expiresAt: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { loadRemote(); setPair(null) } }, [open])

  const mint = async () => {
    setBusy(true)
    try { setPair(await api('/api/pair', { method: 'POST' })) } catch (err) { toast.error(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="grid-cols-1 sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t('Fernzugriff')}</DialogTitle>
          <DialogDescription>{t('iPad oder Handy koppeln – ohne LAN-Freigabe, der Tunnel startet mit dem Server.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', remote?.status === 'online' ? 'bg-emerald-500' : remote?.status === 'off' ? 'bg-zinc-400' : 'bg-amber-500')} />
            <span className="font-medium">{remote ? STATUS[remote.status] || remote.status : '…'}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{remote?.mode}</span>
          </div>
          {remote?.url && (
            <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
              <span className="truncate">{remote.url}</span>
              <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => { navigator.clipboard.writeText(remote.url!); toast('URL kopiert') }} aria-label={t('Kopieren')}><Copy className="size-3" /></Button>
            </div>
          )}
          {remote?.mode === 'iroh' && remote.endpointId && (
            <div className="space-y-1 rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">
              <div className="truncate" title={remote.endpointId}>endpoint {remote.endpointId.slice(0, 20)}…</div>
              {remote.relayUrl && <div className="truncate">relay {remote.relayUrl.replace('https://', '')}</div>}
              <div className="truncate">UI {remote.uiUrl || t('lokal')}</div>
            </div>
          )}
          {remote?.mode === 'iroh' && !remote.uiUrl && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('HERMES_UI_URL ist nicht gesetzt: Der QR-Code öffnet die UI dieses Rechners. Für Handy/iPad die öffentliche UI-Adresse setzen (z. B. GitHub Pages).')}</p>
          )}
          {remote?.loginUrl && (
            <a href={remote.loginUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
              {t('Tailscale-Anmeldung öffnen')} <ExternalLink className="size-3" />
            </a>
          )}
          {remote?.error && <p className="text-xs text-destructive">{remote.error}</p>}
        </div>

        {isLocal && remote?.status === 'online' && (
          <div className="rounded-lg border p-3">
            {pair ? (
              <div className="flex flex-col items-center gap-2">
                <div className="size-52 rounded-md bg-white p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: pair.svg }} />
                <p className="text-center text-xs text-muted-foreground">{t('Mit der Handy-Kamera scannen. Einmal gültig, {n} min.', { n: Math.round((pair.expiresAt - Date.now()) / 60000) })}</p>
                <Button variant="ghost" size="sm" onClick={mint} disabled={busy}><RefreshCw className="size-3.5" />{t('Neuer Code')}</Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-xs text-muted-foreground">{t('Ein Gerät koppeln: QR-Code anzeigen und mit dem Handy scannen.')}</p>
                <Button size="sm" onClick={mint} disabled={busy}>{t('Gerät koppeln')}</Button>
              </div>
            )}
          </div>
        )}
        {!isLocal && <p className="text-xs text-muted-foreground">{t('Neue Geräte lassen sich nur am Rechner koppeln.')}</p>}

        <Separator />
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">{t('Angemeldete Geräte')}</div>
          {devices.length === 0 && <p className="text-xs text-muted-foreground">{t('Keine.')}</p>}
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm">
              <span className="truncate">{d.name}</span>{d.irohId && <span className="font-mono text-[10px] text-muted-foreground">iroh {d.irohId.slice(0, 8)}</span>}
              <span className="text-xs text-muted-foreground">{d.remote ? t('remote') : t('lokal')} · {relTime(d.lastSeen / 1000)}</span>
              <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => revokeDevice(d.id)} aria-label={t('Gerät entfernen')}><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="self-start" onClick={() => { onOpenChange(false); logout() }}><LogOut className="size-3.5" />{t('Dieses Gerät abmelden')}</Button>
      </DialogContent>
    </Dialog>
  )
}
