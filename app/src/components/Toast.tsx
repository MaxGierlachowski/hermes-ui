// In-app notices, the same on phone, web and desktop (the look of the web UI's sonner toasts):
// a small card with an icon, a title and an optional second line; up to three stack with a slight
// offset (hover spreads them out), each fades in and out quickly and goes after 4 s (errors 6 s; the
// clock stops while the pointer is on the stack). A click opens the chat; the close button shows on hover.
// Position: bottom left on wide screens (like the web UI), above the tab bar on a phone.
import { useEffect, useRef, useState } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColorScheme } from 'nativewind'
import { CircleCheck, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react-native'
import { showInboxItem, showThread } from '@/lib/nav'
import { dismissToast, useStore, type ToastItem } from '@/lib/store'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// The toast token: one place for size, shape, elevation and timing.
export const TOAST = {
  width: 356,
  gap: 8,
  /** Visible part of a stacked toast behind the front one. */
  peek: 10,
  visible: 3,
  durationMs: { info: 4000, success: 4000, error: 6000 },
  inMs: 180,
  outMs: 140,
  // Light: a soft two-layer shadow. Dark: no shadow; the 1 px border and the slightly lighter surface
  // (bg-popover) carry the edge.
  shadowLight: '0 1px 2px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.06)',
} as const

const ICON: Record<ToastItem['kind'], { icon: LucideIcon; color: string }> = {
  success: { icon: CircleCheck, color: '#10b981' },
  error: { icon: OctagonAlert, color: '#ef4444' },
  info: { icon: Info, color: '#6366f1' },
}

const EASE = Easing.out(Easing.cubic)

function ToastCard({ item, depth, offset, paused, wide, onHeight, onHover }: { item: ToastItem; depth: number; offset: number; paused: boolean; wide: boolean; onHeight: (h: number) => void; onHover: (on: boolean) => void }) {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const shown = useSharedValue(0)
  const y = useSharedValue(0)
  const scale = useSharedValue(1)
  const [leaving, setLeaving] = useState(false)
  const remaining = useRef<number>(TOAST.durationMs[item.kind])
  const started = useRef(Date.now())

  const leave = () => {
    if (leaving) return
    setLeaving(true)
    shown.value = withTiming(0, { duration: TOAST.outMs, easing: EASE })
    setTimeout(() => dismissToast(item.id), TOAST.outMs)
  }

  useEffect(() => { shown.value = withTiming(1, { duration: TOAST.inMs, easing: EASE }) }, [])
  // Stack position: behind the front toast with a small offset, or spread out while hovered.
  useEffect(() => {
    y.value = withTiming(-offset, { duration: TOAST.inMs, easing: EASE })
    scale.value = withTiming(paused ? 1 : 1 - depth * 0.05, { duration: TOAST.inMs, easing: EASE })
  }, [offset, depth, paused])
  // Auto-dismiss; the clock stops while the pointer is on the stack.
  useEffect(() => {
    if (paused) { remaining.current -= Date.now() - started.current; return }
    started.current = Date.now()
    const timer = setTimeout(leave, Math.max(600, remaining.current))
    return () => clearTimeout(timer)
  }, [paused])

  const style = useAnimatedStyle(() => ({
    opacity: shown.value * (depth >= TOAST.visible ? 0 : 1),
    transform: [{ translateY: y.value + (1 - shown.value) * 12 }, { scale: scale.value }],
  }))
  const { icon, color } = ICON[item.kind]
  return (
    <Animated.View
      style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 100 - depth }, style]}
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      pointerEvents={depth >= TOAST.visible ? 'none' : 'auto'}
    >
      <Pressable
        onPress={() => { leave(); if (item.sessionId) showThread(item.sessionId); else if (item.itemId) showInboxItem(item.itemId) }}
        onHoverIn={() => onHover(true)}
        onHoverOut={() => onHover(false)}
        accessibilityRole="alert"
        className={cn('flex-row items-start gap-2.5 rounded-xl border border-border bg-popover px-3.5 py-3', wide && 'web:cursor-pointer')}
        style={dark ? undefined : ({ boxShadow: TOAST.shadowLight } as object)}
      >
        {/* react-native-web adds `hovered` to the state; on phones it is undefined (no close button, a tap dismisses). */}
        {(state) => { const hovered = (state as { hovered?: boolean }).hovered; return (
          <>
            <Icon as={icon} size={15} color={color} style={{ marginTop: 1 }} />
            <View className="flex-1 gap-0.5">
              <Text className="text-[13px] font-medium leading-[18px] text-popover-foreground" numberOfLines={2}>{item.text}</Text>
              {!!item.description && <Text className="text-xs leading-4 text-muted-foreground" numberOfLines={2}>{item.description}</Text>}
            </View>
            <Pressable
              onPress={leave}
              hitSlop={8}
              accessibilityLabel={t('Schließen')}
              className={cn('-mr-1 -mt-0.5 h-5 w-5 items-center justify-center rounded-md web:hover:bg-accent', !hovered && 'opacity-0')}
            >
              <Icon as={X} size={13} tone="muted-foreground" />
            </Pressable>
          </>
        ) }}
      </Pressable>
    </Animated.View>
  )
}

export function Toast() {
  const toasts = useStore((s) => s.toasts)
  const insets = useSafeAreaInsets()
  const wide = useWindowDimensions().width >= 700
  const [hovered, setHovered] = useState(false)
  const heights = useRef(new Map<number, number>())
  const [, rerender] = useState(0)
  if (!toasts.length) return null

  // Newest in front (depth 0); offsets: stacked with a peek, or spread out while hovered.
  const ordered = [...toasts].reverse()
  let spread = 0
  const offsets = ordered.map((item, depth) => {
    if (depth === 0) return 0
    const prev = heights.current.get(ordered[depth - 1].id) ?? 56
    spread += prev + TOAST.gap
    return hovered ? spread : depth * TOAST.peek
  })
  const front = heights.current.get(ordered[0].id) ?? 56
  const height = hovered ? spread + (heights.current.get(ordered[ordered.length - 1].id) ?? 56) : front + Math.min(ordered.length - 1, TOAST.visible - 1) * TOAST.peek

  return (
    // Hovering a toast pauses the timers and spreads the stack out.
    <View
      pointerEvents="box-none"
      style={wide
        ? { position: 'absolute', left: 16, bottom: 16, width: TOAST.width, height, maxWidth: '90%' }
        : { position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 76, height }}
    >
      {ordered.map((item, depth) => (
        <ToastCard
          key={item.id}
          item={item}
          depth={depth}
          offset={offsets[depth]}
          paused={hovered}
          wide={wide}
          onHeight={(h) => { if (heights.current.get(item.id) !== h) { heights.current.set(item.id, h); rerender((n) => n + 1) } }}
          onHover={setHovered}
        />
      ))}
    </View>
  )
}
