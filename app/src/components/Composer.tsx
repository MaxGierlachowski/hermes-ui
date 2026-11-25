import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { fileUpload } from '@/lib/upload'
import { useVoiceRecorder } from '@/lib/recorder'
import { ArrowUp, AudioLines, Camera, ImagePlus, Mic, RotateCcw, Square, X } from 'lucide-react-native'
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
import { CameraCapture } from './CameraCapture'
import { PermissionNotice } from './PermissionNotice'
import type { PermissionKind } from '@/lib/permissions'
import { shadow } from '@/lib/shadow'

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

// Round buttons: 48 dp touch targets on phones, 28 px inside the desktop prompt box (the web UI's icon-sm).
const BTN = isWebDesktop ? 'h-7 w-7' : 'h-12 w-12'

// RN-web gives a multiline field two rows; one row, growing with the text (field-sizing in PlatformShell.web.tsx).
const WEB_ROWS = Platform.OS === 'web' ? ({ rows: 1 } as object) : {}

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
  // A refused microphone / camera: a notice with the way to the settings instead of a silent failure.
  const [blocked, setBlocked] = useState<PermissionKind | null>(null)
  const [camera, setCamera] = useState(false)
  const [images, setImages] = useState<Picked[]>(initial?.images || [])
  const [busy, setBusy] = useState(false)
  const rec = useVoiceRecorder()
  // A voice message on its way: transcribed by Hermes and sent (one request; the backend transcribes
  // before it submits). failed: kept with "send again" instead of being lost.
  const [voice, setVoice] = useState<{ phase: 'sending' | 'failed'; upload: Upload; secs: number; since: number; error?: string } | null>(null)
  const { colorScheme } = useColorScheme()
  const c = THEME[colorScheme === 'dark' ? 'dark' : 'light']
  useEffect(() => { if (initial?.text) setText(initial.text); if (initial?.images?.length) setImages(initial.images) }, [initial])

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
  // onSend resolves to false when the message was not delivered (the caller already said why).
  const send = async (audio: Upload | null = null, secs = 0) => {
    if (busy || (!text.trim() && !images.length && !audio)) return
    haptic('success')
    setBusy(true)
    if (audio) setVoice({ phase: 'sending', upload: audio, secs, since: Date.now() })
    try {
      const ok = (await onSend({ text: text.trim(), images: images.map((i) => i.upload), audio })) !== false
      if (!ok) { if (audio) setVoice({ phase: 'failed', upload: audio, secs, since: Date.now() }); return }
      setText('')
      setImages([])
      setVoice(null)
    } catch (e) {
      toast(`${t('Nachricht nicht zugestellt')}: ${errText(e)}`, 'error')
      if (audio) setVoice({ phase: 'failed', upload: audio, secs, since: Date.now(), error: errText(e) })
    } finally { setBusy(false) }
  }

  // Every step reports what went wrong: a voice message never fails silently.
  const toggleRecording = async () => {
    if (rec.recording) {
      haptic('select')
      const secs = Math.round(rec.millis / 1000)
      let upload: Upload | null
      try { upload = await rec.stop() } catch (e) { toast(`${t('Aufnahme fehlgeschlagen')}: ${errText(e)}`, 'error'); return }
      if (!upload) { toast(t('Aufnahme ist leer – Mikrofon prüfen'), 'error'); return }
      await send(upload, secs)
      return
    }
    try {
      if ((await rec.start()) === 'denied') { setBlocked('microphone'); return }
    } catch (e) {
      toast(`${t('Mikrofon nicht verfügbar: {err}', { err: errText(e) })}`, 'error')
      return
    }
    setBlocked(null)
    haptic('warning')
  }

  // Desktop: Enter sends (Shift+Enter: new line), images by paste or drop onto the composer.
  useComposerKeys(box, { onSend: () => send(), onImages: (p) => { if (p.length) setImages((x) => [...x, ...p].slice(0, 6)) } })

  const canSend = !!text.trim() || images.length > 0
  const secs = Math.floor(rec.millis / 1000)
  const round = cn('items-center justify-center rounded-full', BTN)
  const ghost = 'active:bg-accent web:transition-colors web:hover:bg-muted'
  const iconSize = isWebDesktop ? 16 : 20

  const attach = (
    <Pressable disabled={rec.recording} onPress={async () => { const p = await pickImage('library'); if (p.length) setImages((x) => [...x, ...p].slice(0, 6)) }} className={cn(round, ghost)} accessibilityLabel={t('Bild anhängen')}>
      <Icon as={ImagePlus} size={iconSize} tone="muted-foreground" />
    </Pressable>
  )
  const camera_ = (
    <Pressable
      disabled={rec.recording}
      onPress={async () => {
        // Desktop / web: the live camera preview; phones: the system camera.
        if (Platform.OS === 'web') { setCamera(true); return }
        const p = await pickImage('camera')
        if (p.length) setImages((x) => [...x, ...p].slice(0, 6))
      }}
      className={cn(round, ghost)}
      accessibilityLabel={t('Foto aufnehmen')}
    >
      <Icon as={Camera} size={iconSize} tone="muted-foreground" />
    </Pressable>
  )
  // A filled round button: the whole 28 px button on the desktop; on phones a 36 px disc inside the 48 dp target.
  const filled = (bg: string, child: ReactNode) => (isWebDesktop ? child : <View className={cn('h-9 w-9 items-center justify-center rounded-full', bg)}>{child}</View>)
  const fill = (bg: string) => (isWebDesktop ? bg : '')
  const actions = (
    <>
      {!canSend && (
        <Pressable onPress={toggleRecording} disabled={voice?.phase === 'sending'} className={cn(round, rec.recording ? fill('bg-destructive') : ghost, voice?.phase === 'sending' && 'opacity-40')} accessibilityLabel={rec.recording ? t('Aufnahme senden') : t('Sprachnachricht')}>
          {rec.recording
            ? filled('bg-destructive', <Icon as={ArrowUp} size={iconSize} tone="primary-foreground" />)
            : <Icon as={Mic} size={iconSize} tone="muted-foreground" />}
        </Pressable>
      )}
      {running && !canSend && !rec.recording ? (
        <Pressable onPress={() => { haptic('warning'); onStop?.() }} className={cn(round, fill('bg-foreground'))} accessibilityLabel={t('Stopp')}>
          {filled('bg-foreground', <Icon as={Square} size={12} color={c.background} fill={c.background} />)}
        </Pressable>
      ) : !rec.recording && (
        <Pressable disabled={!canSend || busy} onPress={() => send()} className={cn(round, fill('bg-primary'), 'web:transition-opacity', (!canSend || busy) && 'opacity-40')} accessibilityLabel={t('Senden')}>
          {filled('bg-primary', busy ? <ActivityIndicator size="small" color="#fff" /> : <Icon as={ArrowUp} size={iconSize} tone="primary-foreground" />)}
        </Pressable>
      )}
    </>
  )
  const thumbs = images.length > 0 && (
    <ScrollView horizontal contentContainerClassName="gap-2 pt-2 pr-2">
      {images.map((img, i) => (
        <View key={img.uri}>
          <Image source={{ uri: img.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} contentFit="cover" />
          <Pressable onPress={() => setImages((x) => x.filter((_, j) => j !== i))} accessibilityLabel={t('Bild entfernen')} className={cn('absolute -right-2 -top-2 items-center justify-center rounded-full bg-foreground', isWebDesktop ? 'h-5 w-5' : 'h-7 w-7')}>
            <Icon as={X} size={isWebDesktop ? 12 : 14} color={c.background} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
  const recording = rec.recording ? (
    <View className={cn('flex-row items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3', isWebDesktop ? 'min-h-10' : 'min-h-12 rounded-2xl px-4')}>
      <View className="h-2.5 w-2.5 rounded-full bg-destructive" />
      <Text className={cn('flex-1', isWebDesktop ? 'text-sm' : 'text-[15px]')}>{t('Aufnahme läuft …')} {mmss(secs)}</Text>
      <Pressable onPress={() => rec.cancel().catch((e) => toast(errText(e), 'error'))} className="h-10 justify-center px-2"><Text className="text-sm text-muted-foreground">{t('Verwerfen')}</Text></Pressable>
    </View>
  ) : null
  const voiceRow = voice && !rec.recording && <VoiceProgress voice={voice} onRetry={() => { const v = voice; setVoice(null); send(v.upload, v.secs) }} onDiscard={() => setVoice(null)} />

  // Desktop: the web UI's prompt box (field and actions in one bordered box, ring on focus, hint below).
  if (isWebDesktop) {
    return (
      <View ref={box} className="gap-1.5 px-3 pb-2 pt-2">
        {blocked && <PermissionNotice kind={blocked} onClose={() => setBlocked(null)} />}
        <CameraCapture open={camera} onClose={() => setCamera(false)} onPhoto={(p) => setImages((x) => [...x, p].slice(0, 6))} onDenied={() => setBlocked('camera')} />
        <View {...({ dataSet: { hkBox: '' } } as object)} className="gap-1 rounded-xl border border-input bg-card p-2" style={shadow('xs', c === THEME.dark)}>
          {thumbs}
          {voiceRow}
          {recording || (
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={placeholder || t('Antworten …')}
              placeholderTextColor={c['muted-foreground']}
              multiline
              {...WEB_ROWS}
              autoFocus={autoFocus}
              className="max-h-60 min-h-10 bg-transparent px-1.5 py-1.5 text-sm leading-5 text-foreground web:font-sans"
            />
          )}
          <View className="flex-row items-center gap-0.5">
            {attach}
            {camera_}
            <View className="flex-1" />
            {actions}
          </View>
        </View>
        <Text className="px-1 text-[11px] text-muted-foreground">{t('↵ senden · ⇧↵ neue Zeile · Bilder per Einfügen oder Drag & Drop')}</Text>
      </View>
    )
  }
  // Phones: one pill like the web UI on touch screens (attach · field · camera / microphone / send).
  return (
    <View ref={box} className="gap-2 border-t border-border bg-background px-3 pb-2 pt-2">
      {blocked && <PermissionNotice kind={blocked} onClose={() => setBlocked(null)} />}
      <CameraCapture open={camera} onClose={() => setCamera(false)} onPhoto={(p) => setImages((x) => [...x, p].slice(0, 6))} onDenied={() => setBlocked('camera')} />
      {thumbs}
      {voiceRow}
      {rec.recording ? (
        <View className="flex-row items-center gap-1">
          <View className="flex-1">{recording}</View>
          {actions}
        </View>
      ) : (
        <View {...({ dataSet: { hkBox: '' } } as object)} className="flex-row items-end rounded-[25px] border border-input bg-card">
          {attach}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder || t('Antworten …')}
            placeholderTextColor={c['muted-foreground']}
            multiline
            {...WEB_ROWS}
            autoFocus={autoFocus}
            className="max-h-40 min-h-12 flex-1 py-3 text-[15px] text-foreground web:font-sans"
            textAlignVertical="center"
          />
          {!canSend && camera_}
          {actions}
        </View>
      )}
    </View>
  )
}
const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

/**
 * A voice message on its way. Hermes' speech-to-text reports no progress, so the bar is indeterminate
 * and the seconds count up; the recording's length says roughly how long it will take.
 * Failed: the take is kept, with "send again" and "discard".
 */
function VoiceProgress({ voice, onRetry, onDiscard }: { voice: { phase: 'sending' | 'failed'; secs: number; since: number; error?: string }; onRetry: () => void; onDiscard: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (voice.phase !== 'sending') return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [voice.phase])
  const waited = Math.max(0, Math.floor((now - voice.since) / 1000))
  if (voice.phase === 'failed') {
    return (
      <View className={cn('flex-row items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3', isWebDesktop ? 'min-h-10' : 'min-h-12 rounded-2xl')} accessibilityRole="alert">
        <Icon as={AudioLines} size={16} tone="destructive" />
        <Text className="flex-1 text-sm text-destructive" numberOfLines={2}>{t('Sprachnachricht ({len}) nicht gesendet', { len: mmss(voice.secs) })}{voice.error ? ` – ${voice.error}` : ''}</Text>
        <Pressable onPress={onRetry} className="h-10 flex-row items-center gap-1 px-2" accessibilityLabel={t('Erneut senden')}><Icon as={RotateCcw} size={14} /><Text className="text-sm">{t('Erneut senden')}</Text></Pressable>
        <Pressable onPress={onDiscard} className="h-10 justify-center px-2"><Text className="text-sm text-muted-foreground">{t('Verwerfen')}</Text></Pressable>
      </View>
    )
  }
  return (
    <View className={cn('gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2', !isWebDesktop && 'rounded-2xl')} accessibilityRole="progressbar" accessibilityLabel={t('Sprachnachricht wird transkribiert …')} {...({ dataSet: { testid: 'voice-progress' } } as object)}>
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" />
        <Text className="flex-1 text-sm" numberOfLines={1}>{t('Sprachnachricht wird transkribiert …')}</Text>
        <Text className="text-xs tabular-nums text-muted-foreground">{t('Aufnahme {len}', { len: mmss(voice.secs) })} · {mmss(waited)}</Text>
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-border">
        <View className="h-1 w-1/3 rounded-full bg-primary web:animate-[voice-progress_1.4s_ease-in-out_infinite]" style={Platform.OS === 'web' ? undefined : { width: `${20 + ((waited * 13) % 60)}%` }} />
      </View>
    </View>
  )
}
