import { useRef, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { parsePairingLink } from '@shared/pairing'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

/** Native QR scanner for pairing links; hands the link to /pair. */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [hint, setHint] = useState('')
  const done = useRef(false)

  if (!permission) return <View className="flex-1 bg-black" />
  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-muted-foreground">{t('Für den QR-Code braucht die App die Kamera.')}</Text>
        <Button onPress={requestPermission}><Text>{t('Kamera erlauben')}</Text></Button>
        <Button variant="ghost" onPress={() => router.back()}><Text>{t('Abbrechen')}</Text></Button>
      </SafeAreaView>
    )
  }
  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return
          if (!parsePairingLink(data)) { setHint(t('Das ist kein Kopplungslink (#iroh=…).')); return }
          done.current = true
          haptic('success')
          router.replace({ pathname: '/pair', params: { link: encodeURIComponent(data) } })
        }}
      />
      <SafeAreaView className="absolute inset-0 justify-between p-4" pointerEvents="box-none">
        <Button variant="secondary" size="icon" className="self-end rounded-full" onPress={() => router.back()} accessibilityLabel={t('Schließen')}>
          <Icon as={X} />
        </Button>
        <View className="items-center gap-2 pb-8">
          <View className="h-64 w-64 rounded-3xl border-2 border-white/80" />
          <Text className="mt-4 text-center text-white">{hint || t('QR-Code von „hermes-ui pair“ in den Rahmen halten')}</Text>
        </View>
      </SafeAreaView>
    </View>
  )
}
