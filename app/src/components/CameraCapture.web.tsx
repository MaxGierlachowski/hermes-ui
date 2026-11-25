// Web / desktop camera: a live preview (getUserMedia) and a shutter button; the photo becomes an
// attachment like a picked image. The first use triggers the system's camera permission (macOS asks
// once with the text from the app's Info.plist).
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, View } from 'react-native'
import { Camera, X } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { useLayer } from '@/lib/nav'
import { useKeydown } from '@/lib/web-input'
import { blobToBase64 } from '@/lib/upload.web'
import { t } from '@/lib/i18n'
import type { Picked } from './Composer'
import { shadow } from '@/lib/shadow'

export function CameraCapture({ open, onClose, onPhoto, onDenied }: { open: boolean; onClose: () => void; onPhoto: (p: Picked) => void; onDenied: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  useLayer(open)
  useKeydown((e) => { if (open && e.key === 'Escape') { e.preventDefault(); onClose() } })

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let alive = true
    setReady(false)
    navigator.mediaDevices?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 } } })
      .then((s) => {
        if (!alive) { s.getTracks().forEach((tr) => tr.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) }
      })
      .catch(() => { if (alive) { onClose(); onDenied() } })
    return () => { alive = false; stream?.getTracks().forEach((tr) => tr.stop()) }
  }, [open])

  const shoot = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85))
    if (!blob) return
    onPhoto({ uri: URL.createObjectURL(blob), upload: { name: 'photo.jpg', type: 'image/jpeg', data: await blobToBase64(blob) } })
    onClose()
  }

  if (!open) return null
  // A Modal renders at the root of the page, above the split pane and the composer.
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <View className="flex-1 items-center justify-center bg-black/60">
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityRole="none" />
      <View className="w-[640px] max-w-[92%] overflow-hidden rounded-xl border border-foreground/10 bg-popover" style={shadow('lg')}>
        <View className="h-11 flex-row items-center border-b border-border pl-4 pr-1">
          <Text className="flex-1 text-[14px] font-semibold">{t('Foto aufnehmen')}</Text>
          <Button variant="ghost" size="icon" onPress={onClose} accessibilityLabel={t('Schließen')}><Icon as={X} size={18} /></Button>
        </View>
        <View className="aspect-[4/3] w-full items-center justify-center bg-black">
          <video ref={video} muted playsInline onLoadedData={() => setReady(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          {!ready && <View className="absolute"><ActivityIndicator color="#fff" /></View>}
        </View>
        <View className="flex-row items-center justify-center p-3">
          <Button disabled={!ready} onPress={shoot} accessibilityLabel={t('Foto aufnehmen')}><Icon as={Camera} size={16} tone="primary-foreground" /><Text>{t('Foto aufnehmen')}</Text></Button>
        </View>
      </View>
    </View>
    </Modal>
  )
}
