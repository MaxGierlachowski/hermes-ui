import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { login, redeemPairing, useBoard } from '@/lib/store'
import { forgetRemote } from '@/lib/backend'
import { useConnection } from '@/lib/useConnection'
import { t } from '@/lib/i18n'

function Frame({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-background p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">H</div>
          <div>
            <div className="font-semibold">Hermes UI</div>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Paste a pairing link (from `hermes-ui pair` or the remote dialog on the host). */
function PairingLinkForm() {
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          const u = new URL(link.trim())
          if (!new URLSearchParams(u.hash.slice(1)).get('iroh')) throw new Error()
          location.hash = u.hash
          location.reload()
        } catch { setError('Das ist kein Kopplungslink (#iroh=…).') }
      }}
    >
      <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t('Kopplungslink einfügen')} />
      <Button className="w-full" variant="secondary" disabled={!link.trim()}>{t('Verbinden')}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}

export function Login() {
  const auth = useBoard((s) => s.auth)
  const conn = useConnection()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [pairing, setPairing] = useState(false)

  // Tunnel modes (Tailscale/Cloudflare): /pair#<code> from the QR code on the host.
  useEffect(() => {
    if (!location.pathname.endsWith('/pair') || !location.hash) return
    const code = decodeURIComponent(location.hash.slice(1))
    history.replaceState(null, '', location.pathname.replace(/pair$/, ''))
    setPairing(true)
    redeemPairing(code).catch((e) => { setError(e.message); setPairing(false) })
  }, [])

  if (conn.mode === 'iroh') {
    if (conn.status === 'connecting') return <Frame subtitle={t('Verbinde über iroh …')}><div className="flex justify-center py-6"><Loader variant="dots" /></div></Frame>
    return (
      <Frame subtitle={conn.status === 'error' ? 'iroh-Verbindung fehlgeschlagen' : t('Gerät nicht gekoppelt')}>
        <p className="text-sm text-muted-foreground">
          {conn.status === 'error'
            ? t('Das Backend ist über iroh nicht erreichbar ({err}). Läuft es mit --remote iroh?', { err: conn.error || '' })
            : t('Dieses Gerät ist nicht (mehr) für das Backend freigegeben. Erzeuge auf dem Rechner einen neuen Kopplungscode (Fernzugriff → Gerät koppeln oder `hermes-ui pair`) und scanne ihn.')}
        </p>
        <p className="break-all font-mono text-[11px] text-muted-foreground">Backend {conn.endpointId.slice(0, 16)}…</p>
        <PairingLinkForm />
        <Button variant="ghost" size="sm" onClick={forgetRemote}>{t('Verbindung vergessen')}</Button>
      </Frame>
    )
  }

  if (auth === 'no-backend') {
    return (
      <Frame subtitle={t('Nicht verbunden')}>
        <p className="text-sm text-muted-foreground">
          {t('Diese Oberfläche enthält keine Daten. Sie verbindet sich per iroh mit deinem Hermes-UI-Backend. Starte dort {cmd} (oder Fernzugriff → Gerät koppeln) und scanne den QR-Code – oder füge den Link hier ein.', { cmd: '`hermes-ui pair`' })}
        </p>
        <PairingLinkForm />
      </Frame>
    )
  }

  return (
    <Frame subtitle={pairing ? t('Gerät wird gekoppelt …') : t('Anmelden')}>
      {!pairing && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setError('')
            try { await login(token.trim()) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
          }}
        >
          <Input type="password" autoComplete="current-password" placeholder={t('Token (HERMES_UI_TOKEN aus .env)')} value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
          <Button className="w-full" disabled={!token.trim()}>{t('Anmelden')}</Button>
          <p className="text-xs text-muted-foreground">{t('Am Handy einfacher: am Rechner unter Fernzugriff „Gerät koppeln“ und den QR-Code scannen.')}</p>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Frame>
  )
}
