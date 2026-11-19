import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Composer, fileUpload, type Picked } from '@/components/Composer'
import { createChat, toast } from '@/lib/store'
import { showThread } from '@/lib/nav'
import { takeSharedDraft } from '@/lib/share'
import { t } from '@/lib/i18n'

/** New chat. Also the target of "Share → Hermes UI" (text and/or image prefilled). */
export default function NewChat() {
  const insets = useSafeAreaInsets()
  const [initial, setInitial] = useState<{ text?: string; images?: Picked[] } | undefined>()
  useEffect(() => {
    const d = takeSharedDraft()
    if (!d) return
    ;(async () => {
      const images: Picked[] = []
      if (d.imageUri) {
        try { images.push({ uri: d.imageUri, upload: await fileUpload(d.imageUri, d.mimeType || 'image/jpeg', 'shared-image') }) } catch { toast(t('Bild nicht verfügbar'), 'error') }
      }
      setInitial({ text: d.text, images })
    })()
  }, [])
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 border-b border-border px-2 pb-1" style={{ paddingTop: insets.top + 2 }}>
        <Button variant="ghost" size="icon" onPress={() => router.back()} accessibilityLabel={t('Schließen')}><Icon as={X} /></Button>
        <Text className="flex-1 text-[17px] font-semibold">{t('Neuer Chat')}</Text>
      </View>
      <View className="flex-1 justify-end p-4">
        <Text className="text-sm text-muted-foreground">{t('Hermes startet eine neue Session. Text, Bilder oder eine Sprachnachricht.')}</Text>
      </View>
      <View style={{ paddingBottom: insets.bottom }}>
        <Composer
          autoFocus={!initial}
          initial={initial}
          placeholder={t('Worum geht es?')}
          onSend={async (msg) => {
            const s = await createChat(msg).catch((e) => { toast(e instanceof Error ? e.message : String(e), 'error'); return null })
            if (!s) return
            showThread(s.id, { replace: true })
          }}
        />
      </View>
    </KeyboardAvoidingView>
  )
}
