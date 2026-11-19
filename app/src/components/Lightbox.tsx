import { useEffect, useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'
import { useLayer } from '@/lib/nav'

/**
 * Full-screen image: pinch to zoom, pan while zoomed, double tap toggles 2.5×. Back button closes it.
 * Fades in 150 ms / out 120 ms itself (the Modal "fade" uses Android's 500 ms config_longAnimTime).
 */
export function Lightbox({ uri: openUri, onClose }: { uri: string | null; onClose: () => void }) {
  useLayer(!!openUri)
  const insets = useSafeAreaInsets()
  const [uri, setUri] = useState(openUri)
  const fade = useSharedValue(0)
  useEffect(() => {
    if (openUri) { setUri(openUri); fade.value = withTiming(1, { duration: 150 }); return }
    fade.value = withTiming(0, { duration: 120 }, (done) => { if (done) runOnJS(setUri)(null) })
  }, [openUri])
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }))
  const scale = useSharedValue(1)
  const saved = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const sx = useSharedValue(0)
  const sy = useSharedValue(0)
  const reset = () => { 'worklet'; scale.value = withTiming(1); saved.value = 1; tx.value = withTiming(0); ty.value = withTiming(0); sx.value = 0; sy.value = 0 }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(6, saved.value * e.scale)) })
    .onEnd(() => { saved.value = scale.value; if (scale.value <= 1.02) reset() })
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => { if (scale.value > 1) { tx.value = sx.value + e.translationX; ty.value = sy.value + e.translationY } })
    .onEnd(() => { sx.value = tx.value; sy.value = ty.value })
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    if (scale.value > 1) reset()
    else { scale.value = withTiming(2.5); saved.value = 2.5 }
  })
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }))

  return (
    <Modal visible={!!uri} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { reset(); onClose() }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View className="flex-1 bg-black" style={fadeStyle}>
          <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
            <Animated.View style={[{ flex: 1 }, style]}>
              {uri && <Image source={{ uri }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={t('Bild')} />}
            </Animated.View>
          </GestureDetector>
          <Pressable onPress={() => { reset(); onClose() }} accessibilityLabel={t('Schließen')} className="absolute right-3 h-12 w-12 items-center justify-center rounded-full bg-black/60" style={{ top: insets.top + 8 }}>
            <Icon as={X} color="#fff" />
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}
