import { createContext, useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { ImageOff, Pause, Play } from 'lucide-react-native'
import { cachedMediaFile, mediaFile } from '@/lib/connection'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'
import { isWebDesktop } from '@/lib/web-input'

// Images in a chat: 360 px wide with a mouse (the web UI's size), 240 on phones.
const IMG_W = isWebDesktop ? 360 : 240

/**
 * Set by a screen while its open transition runs: downloads wait until it has finished, so the
 * animation does not compete with network and decoding work. Files already on disk show at once.
 */
export const TransitionReady = createContext(true)

/** Backend media URL → local file over iroh (cached), or null while loading / on error. */
export function useMediaFile(url: string) {
  const ready = useContext(TransitionReady)
  const [state, setState] = useState<{ uri: string | null; error: boolean }>(() => ({ uri: cachedMediaFile(url), error: false }))
  useEffect(() => {
    if (state.uri || !ready) return
    let alive = true
    mediaFile(url).then((uri) => alive && setState({ uri, error: false }), () => alive && setState({ uri: null, error: true }))
    return () => { alive = false }
  }, [url, ready])
  return state
}

// Aspect ratio per image, so a thread opened again lays out at the final size in its first frame.
const ratios = new Map<string, number>()

export function MediaImage({ url, onOpen }: { url: string; onOpen: (uri: string) => void }) {
  const { uri, error } = useMediaFile(url)
  const [ratio, setRatio] = useState(() => ratios.get(url) ?? 4 / 3)
  // A file that arrived but does not decode shows the same hint as a failed download, not an empty box.
  const [broken, setBroken] = useState(false)
  if (error || broken) return <View className="h-24 w-40 flex-row items-center justify-center gap-2 rounded-lg border border-border"><Icon as={ImageOff} size={16} tone="muted-foreground" /><Text className="text-xs text-muted-foreground">{t('Bild nicht verfügbar')}</Text></View>
  // The placeholder has the size the image will most likely have: no jump when it arrives.
  if (!uri) return <View className="items-center justify-center rounded-[10px] bg-muted" style={{ width: IMG_W, maxWidth: '100%', aspectRatio: ratio }}><ActivityIndicator /></View>
  return (
    <Pressable onPress={() => onOpen(uri)} accessibilityLabel={t('Bild vergrößern')} style={{ maxWidth: '100%' }}>
      <Image
        source={{ uri }}
        style={{ width: IMG_W, maxWidth: '100%', aspectRatio: ratio, borderRadius: 10 }}
        contentFit="cover"
        onError={(e) => { console.warn(`[hermes-ui] image ${url}: ${e.error}`); setBroken(true) }}
        onLoad={(e) => {
          if (!e.source.width) return
          const r = Math.max(0.5, Math.min(2, e.source.width / e.source.height))
          ratios.set(url, r)
          setRatio(r)
        }}
      />
    </Pressable>
  )
}

function Player({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri)
  const status = useAudioPlayerStatus(player)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <Pressable
      onPress={() => { if (status.playing) player.pause(); else { if (status.didJustFinish || (status.duration && status.currentTime >= status.duration - 0.1)) player.seekTo(0); player.play() } }}
      className="h-12 flex-row items-center gap-3 self-start rounded-full border border-border bg-card px-3"
    >
      <Icon as={status.playing ? Pause : Play} size={18} />
      <Text className="text-sm tabular-nums text-muted-foreground">{fmt(status.currentTime)} / {fmt(status.duration || 0)}</Text>
    </Pressable>
  )
}

export function MediaAudio({ url }: { url: string }) {
  const { uri, error } = useMediaFile(url)
  if (error) return <Text className="text-xs text-muted-foreground">{t('Audio nicht verfügbar')}</Text>
  if (!uri) return <ActivityIndicator className="self-start" />
  return <Player uri={uri} />
}
