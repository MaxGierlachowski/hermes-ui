import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { dismissToast, openThread, useStore } from '@/lib/store'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/** In-app notice above the bottom bar; a tap opens its thread. */
export function Toast() {
  const toast = useStore((s) => s.toast)
  const insets = useSafeAreaInsets()
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismissToast, toast.kind === 'error' ? 6000 : 4000)
    return () => clearTimeout(timer)
  }, [toast?.id])
  if (!toast) return null
  return (
    <Animated.View key={toast.id} entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(150)} pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 76 }}>
      <Pressable
        onPress={() => { dismissToast(); if (toast.sessionId) { openThread(toast.sessionId); router.push(`/thread/${encodeURIComponent(toast.sessionId)}`) } }}
        className={cn('flex-row items-center gap-3 rounded-xl border border-border bg-popover px-4 py-3 shadow-lg', toast.kind === 'error' && 'border-destructive/40')}
      >
        <View className={cn('h-2 w-2 rounded-full', toast.kind === 'error' ? 'bg-destructive' : toast.kind === 'success' ? 'bg-emerald-500' : 'bg-primary')} />
        <Text className="flex-1 text-sm" numberOfLines={3}>{toast.text}</Text>
      </Pressable>
    </Animated.View>
  )
}
