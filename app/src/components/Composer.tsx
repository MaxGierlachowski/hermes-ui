import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { fileUpload } from '@/lib/upload'
import { ArrowUp, Camera, ImagePlus, Mic, Square, X } from 'lucide-react-native'
import { useColorScheme } from 'nativewind'
import type { OutgoingMessage, Upload } from '@shared/types'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { THEME } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'
import { toast } from '@/lib/store'
import { isWebDesktop, useComposerKeys } from '@/lib/web-input'

export type Picked = { uri: string; upload: Upload }

export async function pickImage(source: 'library' | 'camera'): Promise<Picked[]> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true }
  if (!perm.granted) return []
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.75, allowsMultipleSelection: source === 'library', selectionLimit: 4 }
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
  if (r.canceled) return []
  return r.assets.filter((a) => a.base64).map((a) => ({ uri: a.uri, upload: { name: a.fileName || 'image.jpg', type: a.mimeType || 'image/jpeg', data: a.base64! } }))
}

export { fileUpload }

// Round buttons: 48 dp touch targets on phones, 36 px with a mouse.
const BTN = isWebDesktop ? 'h-9 w-9' : 'h-12 w-12'

// Unsent text per chat survives closing and reopening it (like the web UI).
const drafts = new Map<string, string>()

/**
 * Text, images (gallery / camera), voice message, send — or stop while Hermes works and the field is
 * empty. Sits above the keyboard (the screen uses KeyboardAvoidingView); touch targets are 48 dp.
 */
export function Composer({ onSend, running, onStop, initial, placeholder, autoFocus, draftKey }: {
  onSend: (msg: OutgoingMessage) => Promise<unknown>
  running?: boolean
  onStop?: () => void
  initial?: { text?: string; images?: Picked[] }
  placeholder?: string
  autoFocus?: boolean
  /** Keeps unsent text under this key (the chat id). */
  draftKey?: string
}) {
  const [text, setTextState] = useState(initial?.text || (draftKey ? drafts.get(draftKey) : '') || '')
  const setText = (v: string) => { setTextState(v); if (draftKey) { if (v) drafts.set(draftKey, v); else drafts.delete(draftKey) } }
  const box = useRef<ComponentRef<typeof View>>(null)
  const [images, setImages] = useState<Picked[]>(initial?.images || [])
  const [busy, setBusy] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const rec = useAudioRecorderState(recorder, 250)
  const { colorScheme } = useColorScheme()
  const c = THEME[colorScheme === 'dark' ? 'dark' : 'light']
  useEffect(() => { if (initial?.text) setText(initial.text); if (initial?.images?.length) setImages(initial.images) }, [initial])

  const send = async (audio: Upload | null = null) => {
    if (busy || (!text.trim() && !images.length && !audio)) return
    haptic('success')
    setBusy(true)
    try {
      await onSend({ text: text.trim(), images: images.map((i) => i.upload), audio })
      setText('')
      setImages([])
    } finally { setBusy(false) }
  }

  const toggleRecording = async () => {
    if (rec.isRecording) {
      haptic('select')
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      const uri = recorder.uri
      if (!uri) return
      const upload = await fileUpload(uri, 'audio/mp4', 'voice.m4a')
      if (!upload.data) { toast(t('Aufnahme ist leer – Mikrofon prüfen'), 'error'); return }
      await send(upload)
      return
    }
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) { toast(`${t('Mikrofon nicht erlaubt')}: ${t('Erlaube das Mikrofon in den Android-Einstellungen der App.')}`, 'error'); return }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    haptic('warning')
  }

  // Desktop: Enter sends (Shift+Enter: new line), images by paste or drop onto the composer.
  useComposerKeys(box, { onSend: () => send(), onImages: (p) => { if (p.length) setImages((x) => [...x, ...p].slice(0, 6)) } })

  const canSend = !!text.trim() || images.length > 0
  const secs = Math.floor((rec.durationMillis || 0) / 1000)
  return (
    <View ref={box} className="gap-2 border-t border-border bg-background px-3 pb-2 pt-2">
      {images.length > 0 && (
        <ScrollView horizontal contentContainerClassName="gap-2">
          {images.map((img, i) => (
            <View key={img.uri}>
              <Image source={{ uri: img.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} contentFit="cover" />
              <Pressable onPress={() => setImages((x) => x.filter((_, j) => j !== i))} accessibilityLabel={t('Bild entfernen')} className="absolute -right-2 -top-2 h-7 w-7 items-center justify-center rounded-full bg-foreground">
                <Icon as={X} size={14} color={c.background} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {rec.isRecording ? (
        <View className="min-h-12 flex-row items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4">
          <View className="h-2.5 w-2.5 rounded-full bg-destructive" />
          <Text className="flex-1 text-[15px]">{t('Aufnahme läuft …')} {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</Text>
          <Pressable onPress={async () => { await recorder.stop(); await setAudioModeAsync({ allowsRecording: false }) }} className="h-10 justify-center px-2"><Text className="text-sm text-muted-foreground">{t('Verwerfen')}</Text></Pressable>
        </View>
      ) : (
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder || t('Antworten …')}
          placeholderTextColor={c['muted-foreground']}
          multiline
          autoFocus={autoFocus}
          className={cn('max-h-40 rounded-2xl border border-input bg-card px-4 text-foreground', isWebDesktop ? 'min-h-11 py-2.5 text-[14px]' : 'min-h-12 py-3 text-[15px]')}
          textAlignVertical="center"
        />
      )}
      <View className="flex-row items-center gap-1">
        <Pressable disabled={rec.isRecording} onPress={async () => { const p = await pickImage('library'); if (p.length) setImages((x) => [...x, ...p].slice(0, 6)) }} className={cn('items-center justify-center rounded-full active:bg-accent web:hover:bg-accent', isWebDesktop ? 'h-9 w-9' : 'h-12 w-12')} accessibilityLabel={t('Bild anhängen')}>
          <Icon as={ImagePlus} tone="muted-foreground" />
        </Pressable>
        {!isWebDesktop && (
          <Pressable disabled={rec.isRecording} onPress={async () => { const p = await pickImage('camera'); if (p.length) setImages((x) => [...x, ...p].slice(0, 6)) }} className="h-12 w-12 items-center justify-center rounded-full active:bg-accent" accessibilityLabel={t('Foto aufnehmen')}>
            <Icon as={Camera} tone="muted-foreground" />
          </Pressable>
        )}
        {isWebDesktop && <Text className="ml-1 text-xs text-muted-foreground">{t('↵ senden · ⇧↵ neue Zeile · Bilder per Einfügen oder Drag & Drop')}</Text>}
        <View className="flex-1" />
        {!canSend && (
          <Pressable onPress={toggleRecording} className={cn('items-center justify-center rounded-full', BTN, rec.isRecording ? 'bg-destructive' : 'active:bg-accent')} accessibilityLabel={rec.isRecording ? t('Aufnahme senden') : t('Sprachnachricht')}>
            <Icon as={rec.isRecording ? ArrowUp : Mic} tone={rec.isRecording ? 'primary-foreground' : 'muted-foreground'} />
          </Pressable>
        )}
        {running && !canSend && !rec.isRecording ? (
          <Pressable onPress={() => { haptic('warning'); onStop?.() }} className={cn('items-center justify-center rounded-full bg-foreground', BTN)} accessibilityLabel={t('Stopp')}>
            <Icon as={Square} size={16} color={c.background} fill={c.background} />
          </Pressable>
        ) : !rec.isRecording && (
          <Pressable disabled={!canSend || busy} onPress={() => send()} className={cn('items-center justify-center rounded-full bg-primary', BTN, (!canSend || busy) && 'opacity-40')} accessibilityLabel={t('Senden')}>
            {busy ? <ActivityIndicator color="#fff" /> : <Icon as={ArrowUp} tone="primary-foreground" />}
          </Pressable>
        )}
      </View>
    </View>
  )
}
