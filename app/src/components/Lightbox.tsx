import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Image } from 'expo-image'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ExternalLink, ImageOff, X } from 'lucide-react-native'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { useLayer } from '@/lib/nav'
import { fitImage, imageLabel } from '@/lib/lightbox'
import { openExternal } from '@/lib/desktop'

const MARGIN = 24

/**
 * Full-screen image on a dark backdrop: pinch to zoom, pan while zoomed, double tap toggles 2.5×.
 * Closes with the X, the back button / Esc, or a tap beside the image. Shows a spinner while the image
 * loads and a hint with a link to open it elsewhere when it does not.
 * Fades in 150 ms / out 120 ms itself (the Modal "fade" uses Android's 500 ms config_longAnimTime).
 *
 * Layout and colours of the Animated.Views are plain styles, not classes: NativeWind does not style
 * reanimated's Animated.View on react-native-web, which left the desktop viewer at 0 px height on a
 * transparent backdrop (only the X showed).
 */
export function Lightbox({ uri: openUri, source, onClose }: { uri: string | null; /** The backend media URL it came from (shown when it fails). */ source?: string | null; onClose: () => void }) {
  useLayer(!!openUri)
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const [uri, setUri] = useState(openUri)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const fade = useSharedValue(0)
  useEffect(() => {
    if (openUri) { setUri(openUri); setNatural(null); setStatus('loading'); fade.value = withTiming(1, { duration: 150 }); return }
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
  const close = () => { reset(); onClose() }

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

  // The image gets an explicit size: the free area minus a margin, at the image's aspect ratio.
  const box = { width: Math.max(1, win.width - MARGIN * 2), height: Math.max(1, win.height - insets.top - insets.bottom - MARGIN * 2 - 48) }
  const size = fitImage(natural, box)

  return (
    <Modal visible={!!uri} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.fill, styles.backdrop, fadeStyle]}>
          {/* A tap beside the image closes the viewer. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
          <View pointerEvents="box-none" style={[styles.fill, styles.center, { paddingTop: insets.top + 48, paddingBottom: insets.bottom }]}>
            {status !== 'error' && (
              <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
                <Animated.View style={[size, style]} {...({ dataSet: { testid: 'lightbox-image' } } as object)}>
                  {uri && (
                    <Image
                      source={{ uri }}
                      style={styles.fill}
                      contentFit="contain"
                      accessibilityLabel={t('Bild')}
                      onLoad={(e) => { setStatus('ok'); if (e.source.width) setNatural({ width: e.source.width, height: e.source.height }) }}
                      onError={(e) => { console.warn(`[hermes-ui] lightbox ${uri}: ${e.error}`); setStatus('error') }}
                    />
                  )}
                </Animated.View>
              </GestureDetector>
            )}
            {status === 'loading' && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator size="large" color="#fff" /></View>}
            {status === 'error' && uri && (
              <View style={styles.error} accessibilityRole="alert">
                <Icon as={ImageOff} size={28} color="#fff" />
                <Text className="text-center text-[15px] font-medium" style={styles.white}>{t('Bild konnte nicht geladen werden')}</Text>
                <Text selectable numberOfLines={3} className="text-center font-mono text-xs" style={styles.dim}>{imageLabel(source || uri)}</Text>
                {/* Only plain web URLs: a backend URL carries the access token, which does not belong in a browser's history. */}
                {/^https?:/.test(uri) && !/[?&]token=/.test(uri) && (
                  <Pressable onPress={() => { openExternal(uri) }} accessibilityRole="link" style={styles.link}>
                    <Icon as={ExternalLink} size={14} color="#fff" />
                    <Text className="text-sm" style={styles.white}>{t('Bild öffnen')}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
          <Pressable onPress={close} accessibilityLabel={t('Schließen')} style={[styles.close, { top: insets.top + 8 }]}>
            <Icon as={X} color="#fff" />
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.92)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 12, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  error: { maxWidth: 420, alignItems: 'center', gap: 10, padding: 20, borderRadius: 16, backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  white: { color: '#fff' },
  dim: { color: 'rgba(255, 255, 255, 0.6)' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' },
})
