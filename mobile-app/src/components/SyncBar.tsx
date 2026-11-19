import { useEffect, useState } from 'react'
import { View } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { CloudOff } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { bootstrap, useStore } from '@/lib/store'
import { t } from '@/lib/i18n'

/**
 * Thin indeterminate bar under a header while data refreshes in the background: the screen already
 * shows the cached state, the bar says a newer one is on its way. Appears only after 150 ms so a fast
 * refresh does not flicker.
 */
export function SyncBar() {
  const syncing = useStore((s) => s.syncing > 0 || s.auth === 'connecting')
  const [shown, setShown] = useState(false)
  const [width, setWidth] = useState(0)
  const x = useSharedValue(0)
  useEffect(() => {
    if (!syncing) { setShown(false); return }
    const timer = setTimeout(() => setShown(true), 150)
    return () => clearTimeout(timer)
  }, [syncing])
  useEffect(() => {
    if (!shown) { cancelAnimation(x); x.value = 0; return }
    x.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false)
  }, [shown])
  // A segment of 35 % of the width sweeps from just off the left edge to just off the right one.
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.35 + x.value * 1.35) * width }] }))
  return (
    <View className="h-0.5 overflow-hidden" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={shown ? t('Aktualisiere …') : undefined}>
      {shown && width > 0 && <Animated.View className="absolute left-0 top-0 h-0.5 rounded-full bg-primary" style={[{ width: width * 0.35 }, style]} />}
    </View>
  )
}

/** Offline with cached content on screen: when that content is from, and a way to retry now. */
export function OfflineBanner() {
  const auth = useStore((s) => s.auth)
  const at = useStore((s) => s.boardAt)
  const hydrated = useStore((s) => s.hydrated)
  if (auth !== 'offline' || !hydrated) return null
  const when = at ? new Date(at).toLocaleString(undefined, { dateStyle: new Date(at).toDateString() === new Date().toDateString() ? undefined : 'short', timeStyle: 'short' }) : ''
  return (
    <View className="flex-row items-center gap-2 border-b border-border bg-muted/60 py-1.5 pl-4 pr-2">
      <Icon as={CloudOff} size={15} tone="muted-foreground" />
      <Text className="flex-1 text-[13px] text-muted-foreground" numberOfLines={1}>{t('Offline, Stand von {when}', { when })}</Text>
      <Button variant="ghost" size="sm" onPress={() => bootstrap()}><Text className="text-[13px]">{t('Erneut verbinden')}</Text></Button>
    </View>
  )
}
