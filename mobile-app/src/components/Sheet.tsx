import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const IN = { duration: 220, easing: Easing.out(Easing.cubic) }
const OUT = { duration: 160, easing: Easing.in(Easing.quad) }

/**
 * Bottom sheet: slides in within 220 ms (the RN Modal "slide" animation takes the platform's ~400 ms),
 * dismissed by a tap on the backdrop, the back button or a downward swipe on the sheet.
 */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(open)
  const [height, setHeight] = useState(0)
  const y = useSharedValue(1000)
  const fade = useSharedValue(0)

  useEffect(() => {
    if (open) { setMounted(true); return }
    if (!mounted) return
    fade.value = withTiming(0, OUT)
    y.value = withTiming(height || 600, OUT, (done) => { if (done) runOnJS(setMounted)(false) })
  }, [open])
  // Slide in once the sheet's height is known.
  useEffect(() => {
    if (!open || !height) return
    y.value = height
    fade.value = withTiming(1, IN)
    y.value = withTiming(0, IN)
  }, [open, height])

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => { y.value = Math.max(0, e.translationY) })
    .onEnd((e) => {
      if (e.translationY > height * 0.3 || e.velocityY > 800) runOnJS(onClose)()
      else y.value = withSpring(0, { damping: 22, stiffness: 260 })
    })

  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }))
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  if (!mounted) return null
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View className="absolute inset-0 bg-black/40" style={backdrop}>
          <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" />
        </Animated.View>
        <View className="flex-1 justify-end" pointerEvents="box-none">
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
              className="rounded-t-2xl border-t border-border bg-background px-4 pt-3"
              style={[{ paddingBottom: insets.bottom + 12 }, panel, !height && { opacity: 0 }]}
            >
              <View className="mb-2 h-1 w-10 self-center rounded-full bg-border" />
              {children}
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}
