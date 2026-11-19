import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { ClipboardPaste, PlayCircle, QrCode } from 'lucide-react-native'
import { parsePairingLink } from '@shared/pairing'
import { pair, startDemo, useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

/**
 * Pairing: scan the QR code of `hermes-ui pair` (or Remote access → Pair device), open the link,
 * or paste it. Deep links hermesui://pair?iroh=…&relay=…&pair=… and https://<ui>/#iroh=… land here.
 */
export default function PairScreen() {
  const params = useLocalSearchParams<{ iroh?: string; relay?: string; pair?: string; link?: string }>()
  const auth = useStore((s) => s.auth)
  const storeError = useStore((s) => s.error)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (value: string) => {
    setError('')
    if (!parsePairingLink(value)) { setError(t('Das ist kein Kopplungslink (#iroh=…).')); return }
    setBusy(true)
    try {
      await pair(value)
      haptic('success')
      router.replace('/')
    } catch (e) {
      haptic('warning')
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  // Opened through a deep link: pair right away.
  useEffect(() => {
    const fromLink = params.link ? decodeURIComponent(params.link) : params.iroh ? `#${new URLSearchParams(Object.entries({ iroh: params.iroh, relay: params.relay, pair: params.pair }).filter(([, v]) => !!v) as [string, string][])}` : ''
    if (fromLink) { setLink(fromLink); submit(fromLink) }
  }, [params.link, params.iroh, params.pair])

  if (auth === 'ok' && !busy && !params.iroh && !params.link) return <Redirect href="/" />

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center gap-6 p-6" keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-primary"><Text className="text-xl font-bold text-primary-foreground">H</Text></View>
            <View>
              <Text className="text-xl font-semibold">Hermes UI</Text>
              <Text className="text-sm text-muted-foreground">{busy ? t('Gerät wird gekoppelt …') : t('Nicht verbunden')}</Text>
            </View>
          </View>
          <Text className="text-[15px] leading-6 text-muted-foreground">
            {t('Diese Oberfläche enthält keine Daten. Sie verbindet sich per iroh mit deinem Hermes-UI-Backend. Starte dort {cmd} (oder Fernzugriff → Gerät koppeln) und scanne den QR-Code – oder füge den Link hier ein.', { cmd: 'hermes-ui pair' })}
          </Text>
          <Button size="lg" onPress={() => router.push('/scan')} disabled={busy}>
            <Icon as={QrCode} tone="primary-foreground" />
            <Text>{t('QR-Code scannen')}</Text>
          </Button>
          <View className="gap-2">
            <Input value={link} onChangeText={setLink} placeholder={t('Kopplungslink einfügen')} autoCapitalize="none" autoCorrect={false} editable={!busy} onSubmitEditing={() => submit(link)} />
            <View className="flex-row gap-2">
              <Button variant="outline" className="flex-1" disabled={busy} onPress={async () => { const v = await Clipboard.getStringAsync(); setLink(v); if (parsePairingLink(v)) submit(v) }}>
                <Icon as={ClipboardPaste} size={18} />
                <Text>{t('Einfügen')}</Text>
              </Button>
              <Button variant="secondary" className="flex-1" disabled={busy || !link.trim()} onPress={() => submit(link)}>
                {busy ? <ActivityIndicator /> : <Text>{t('Verbinden')}</Text>}
              </Button>
            </View>
            {!!(error || storeError) && <Text className="text-sm text-destructive">{error || storeError}</Text>}
          </View>
          <View className="gap-2 border-t border-border pt-5">
            <Button variant="ghost" disabled={busy} onPress={async () => { await startDemo(); router.replace('/') }} accessibilityHint={t('Zeigt die App mit Beispieldaten, ohne Backend.')}>
              <Icon as={PlayCircle} size={18} />
              <Text>{t('Demo ansehen')}</Text>
            </Button>
            <Text className="text-center text-xs text-muted-foreground">{t('Ohne eigenes Backend: Beispieldaten, nichts verlässt das Gerät.')}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
