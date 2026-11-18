import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { ImageOff, Pause, Play } from 'lucide-react-native'
import { mediaFile } from '@/lib/connection'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'

/** Backend media URL → local file over iroh (cached), or null while loading / on error. */
export function useMediaFile(url: string) {
  const [state, setState] = useState<{ uri: string | null; error: boolean }>({ uri: null, error: false })
  useEffect(() => {
    let alive = true
    mediaFile(url).then((uri) => alive && setState({ uri, error: false }), () => alive && setState({ uri: null, error: true }))
    return () => { alive = false }
  }, [url])
  return state
}

export function MediaImage({ url, onOpen }: { url: string; onOpen: (uri: string) => void }) {
  const { uri, error } = useMediaFile(url)
  const [ratio, setRatio] = useState(4 / 3)
  if (error) return <View className="h-24 w-40 flex-row items-center justify-center gap-2 rounded-lg border border-border"><Icon as={ImageOff} size={16} tone="muted-foreground" /><Text className="text-xs text-muted-foreground">{t('Bild nicht verfügbar')}</Text></View>
  if (!uri) return <View className="h-40 w-56 items-center justify-center rounded-lg bg-muted"><ActivityIndicator /></View>
  return (
    <Pressable onPress={() => onOpen(uri)} accessibilityLabel={t('Bild vergrößern')}>
      <Image source={{ uri }} style={{ width: 240, aspectRatio: ratio, borderRadius: 10 }} contentFit="cover" onLoad={(e) => e.source.width && setRatio(Math.max(0.5, Math.min(2, e.source.width / e.source.height)))} />
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
