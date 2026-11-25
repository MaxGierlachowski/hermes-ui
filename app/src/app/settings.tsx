import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColorScheme } from 'nativewind'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { ArrowLeft, Check } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { getBackend, libraryInfo, type ConnectionPath } from '@/lib/connection'
import { registerRemotePush, setupNotifications, testNotification } from '@/lib/notify'
import { keepAliveMode, setKeepAliveMode, type KeepAliveMode } from '@/lib/keepalive'
import { exitDemo, setPrefs, unpair, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { applyTheme } from '@/lib/theme-mode'
import { confirm } from '@/lib/confirm'
import { PermissionNotice } from '@/components/PermissionNotice'
import { Switch } from '@/components/ui/switch'
import { automationPush, loadAutomationPush, saveAutomationPush, type AutomationPush } from '@/lib/push-settings'
import { haptic } from '@/lib/haptics'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</Text>
      <View className="gap-3 rounded-xl border border-border bg-card p-4">{children}</View>
    </View>
  )
}
const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <View className="gap-0.5">
    <Text className="text-xs text-muted-foreground">{label}</Text>
    <Text selectable className={cn('text-sm', mono && 'font-mono text-[12px]')}>{value}</Text>
  </View>
)

function Choice<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="flex-row gap-2">
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => { haptic('select'); onChange(o.id) }} className={cn('h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border', value === o.id ? 'border-primary bg-primary/10' : 'border-border')}>
          {value === o.id && <Icon as={Check} size={14} tone="primary" />}
          <Text className="text-sm">{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

// Which automation entries become a notification on this device (and, with FCM, a push of the backend).
const AUTOMATION_SWITCHES: { key: keyof AutomationPush; label: string; hint: string }[] = [
  { key: 'automations', label: 'Automationen: Meldungen', hint: 'Cron- und Webhook-Läufe, die etwas melden' },
  { key: 'automationErrors', label: 'Automationen: Fehler', hint: 'Fehlgeschlagene oder blockierte Läufe, notify mit Level error' },
  { key: 'notify', label: 'Nachrichten von Skripten (notify)', hint: 'POST /api/notify und hermes-ui notify' },
]

export default function Settings() {
  const insets = useSafeAreaInsets()
  const { colorScheme } = useColorScheme()
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')
  const days = useStore((s) => s.days)
  const system = useStore((s) => s.system)
  const demo = useStore((s) => s.demo)
  const [path, setPath] = useState<ConnectionPath | null>(null)
  const [push, setPush] = useState('')
  const [keep, setKeep] = useState<KeepAliveMode>(keepAliveMode())
  const [notifBlocked, setNotifBlocked] = useState(false)
  const [auto, setAuto] = useState<AutomationPush>(automationPush())
  const b = getBackend()

  useEffect(() => { AsyncStorage.getItem('hk_theme').then((v) => v && setTheme(v as typeof theme)) }, [])
  useEffect(() => { loadAutomationPush().then(setAuto) }, [])
  useEffect(() => {
    const read = () => setPath(getBackend()?.connectionInfo() ?? null)
    read()
    const timer = setInterval(read, 2000)
    return () => clearInterval(timer)
  }, [])
  const selected = path?.paths.find((p) => p.selected)

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-1 border-b border-border px-1 pb-1" style={{ paddingTop: insets.top + 2 }}>
        <Button variant="ghost" size="icon" onPress={() => router.back()} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>
        <Text className="flex-1 text-[17px] font-semibold">{t('Einstellungen')}</Text>
      </View>
      <ScrollView contentContainerClassName="gap-6 p-4" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Section title={t('Verbindung (iroh, nativ)')}>
          <Row label={t('Pfad')} value={path ? `${path.kind === 'direct' ? t('direkt (UDP, Hole-Punching)') : path.kind === 'relay' ? t('über Relay') : '–'}${selected ? ` · ${selected.rttMs.toFixed(0)} ms` : ''}` : t('keine Verbindung')} />
          {selected && <Row label={t('Adresse')} value={selected.addr} mono />}
          <Row label="Backend (Gateway)" value={b?.gateway.endpointId || '–'} mono />
          {!!b?.gateway.relayUrl && <Row label="Relay" value={b.gateway.relayUrl} mono />}
          <Row label={t('Dieses Gerät')} value={b?.endpointId || '–'} mono />
          {!!b?.relayProblem() && <Row label={t('Relay-Problem')} value={b.relayProblem()!} />}
          <Text className="text-xs text-muted-foreground">{libraryInfo()}</Text>
        </Section>

        <Section title={t('Darstellung')}>
          <Choice
            options={[{ id: 'system', label: t('System') }, { id: 'light', label: t('Hell') }, { id: 'dark', label: t('Dunkel') }]}
            value={theme}
            onChange={(v) => { setTheme(v); applyTheme(v); AsyncStorage.setItem('hk_theme', v) }}
          />
          <Text className="text-xs text-muted-foreground">{t('Aktuell')}: {colorScheme}</Text>
        </Section>

        <Section title="Board">
          <Text className="text-sm">{t('Zeitraum')}</Text>
          <Choice options={[0, 1, 3, 7, 30].map((d) => ({ id: String(d), label: d === 0 ? t('Alle Chats') : d === 1 ? t('1 Tag') : t('{n} Tage', { n: d }) }))} value={String(days)} onChange={(v) => setPrefs({ days: Number(v) })} />
          <Choice options={[{ id: '0', label: t('Cron/System ausblenden') }, { id: '1', label: 'Cron/System' }]} value={system ? '1' : '0'} onChange={(v) => setPrefs({ system: v === '1' })} />
        </Section>

        <Section title={t('Benachrichtigungen')}>
          {Platform.OS === 'web' ? (
            <Text className="text-sm text-muted-foreground">{t('Solange die App läuft (auch nur im Tray), kommen neue Inbox-Einträge als Systembenachrichtigung; ein Klick öffnet den Chat.')}</Text>
          ) : (
            <>
              <Text className="text-sm text-muted-foreground">{t('Solange die App läuft, kommen neue Inbox-Einträge als Systembenachrichtigung. Push bei geschlossener App braucht FCM (siehe README).')}</Text>
              <Text className="text-sm">{t('Im Hintergrund verbunden bleiben')}</Text>
              <Choice
                options={[{ id: 'auto', label: t('Während Hermes arbeitet') }, { id: 'always', label: t('Immer') }, { id: 'off', label: t('Aus') }]}
                value={keep}
                onChange={(v) => { setKeep(v); setKeepAliveMode(v) }}
              />
              <Text className="text-xs text-muted-foreground">{t('Android friert Apps im Hintergrund nach Sekunden ein. Eine dezente Daueranzeige hält die Verbindung offen, damit Antworten ankommen. „Immer“ kostet mehr Akku.')}</Text>
            </>
          )}
          <View className="gap-3 border-t border-border pt-3">
            {AUTOMATION_SWITCHES.map((sw) => (
              <View key={sw.key} className="flex-row items-center gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm">{t(sw.label)}</Text>
                  <Text className="text-xs text-muted-foreground">{t(sw.hint)}</Text>
                </View>
                <Switch value={auto[sw.key]} onValueChange={(v) => { setAuto((a) => ({ ...a, [sw.key]: v })); saveAutomationPush({ [sw.key]: v }) }} accessibilityLabel={t(sw.label)} />
              </View>
            ))}
          </View>
          {notifBlocked && <PermissionNotice kind="notifications" />}
          <Button variant="outline" onPress={async () => { const ok = await setupNotifications(true); setNotifBlocked(!ok); if (ok) await testNotification() }}>
            <Text>{t('Test-Benachrichtigung')}</Text>
          </Button>
          {Platform.OS !== 'web' && (
            <Button variant="outline" onPress={async () => setPush(await registerRemotePush())}>
              <Text>{t('Push (FCM) aktivieren')}</Text>
            </Button>
          )}
          {!!push && <Text className="text-xs text-muted-foreground">{push === 'on' ? t('Push ist aktiv.') : push === 'unavailable' ? t('Diese App-Version wurde ohne Firebase gebaut (google-services.json fehlt) – nur lokale Benachrichtigungen.') : push === 'denied' ? t('Benachrichtigungen sind nicht erlaubt.') : t('Das Backend kennt noch keinen nativen Push (Backend aktualisieren).')}</Text>}
        </Section>

        <Section title={t('Kopplung')}>
          {demo ? (
            <Button variant="outline" onPress={async () => { await exitDemo(); router.replace('/pair') }}>
              <Text>{t('Demo beenden und koppeln')}</Text>
            </Button>
          ) : (
            <Button variant="destructive" onPress={async () => {
              if (!(await confirm(t('Verbindung vergessen'), t('Die App vergisst das Backend. Die Geräte-Identität bleibt, neu koppeln geht jederzeit.'), t('Vergessen')))) return
              await unpair()
              router.replace('/pair')
            }}>
              <Text>{t('Verbindung vergessen')}</Text>
            </Button>
          )}
        </Section>
        <Text className="text-center text-xs text-muted-foreground">Hermes UI {Constants.expoConfig?.version} · MIT</Text>
      </ScrollView>
    </View>
  )
}
