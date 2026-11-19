import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { Bot, Clock, Laptop, LayoutGrid, MessageCircle, Terminal, Webhook, type LucideIcon } from 'lucide-react-native'
import type { AgentState, Column } from '@shared/types'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { isWebDesktop } from '@/lib/web-input'

// 8 px like the web board with a mouse, 10 px on touch screens.
const DOT = isWebDesktop ? 'h-2 w-2' : 'h-2.5 w-2.5'

export const COLUMN_COLOR: Record<Column, string> = {
  new: 'bg-zinc-400 dark:bg-zinc-500',
  doing: 'bg-indigo-500',
  waiting: 'bg-amber-500',
  done: 'bg-emerald-500',
}

/** Status as a dot (web board): pulsing while Hermes works or a prompt waits. */
export function StatusDot({ column, running, pending, className }: { column: Column; running?: boolean; pending?: boolean; className?: string }) {
  const pulse = useSharedValue(0)
  const active = running || pending
  useEffect(() => {
    if (active) pulse.value = withRepeat(withTiming(1, { duration: 1100 }), -1, false)
    else { cancelAnimation(pulse); pulse.value = 0 }
  }, [active])
  const ring = useAnimatedStyle(() => ({ opacity: active ? 0.6 * (1 - pulse.value) : 0, transform: [{ scale: 1 + pulse.value * 1.4 }] }))
  const color = pending ? 'bg-amber-500' : COLUMN_COLOR[column]
  return (
    <View className={cn(DOT, 'items-center justify-center', className)}>
      <Animated.View className={cn('absolute rounded-full', DOT, color)} style={ring} />
      <View className={cn('rounded-full', DOT, color)} />
    </View>
  )
}

export const SOURCE_ICON: Record<string, LucideIcon> = { slack: MessageCircle, desktop: Laptop, kanban: LayoutGrid, cron: Clock, webhook: Webhook, oneshot: Terminal, cli: Terminal }
export const sourceIcon = (source: string) => SOURCE_ICON[source] || Bot

export const AGENT_STATE: Record<AgentState, { label: string; dot: string; text?: string }> = {
  running: { label: t('läuft'), dot: 'bg-indigo-500' },
  'needs-attention': { label: t('wartet auf Freigabe'), dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  finished: { label: t('fertig'), dot: 'bg-emerald-500' },
  idle: { label: 'idle', dot: 'bg-zinc-400' },
  closed: { label: t('beendet'), dot: 'bg-zinc-400' },
  error: { label: t('Fehler'), dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  archived: { label: t('archiviert'), dot: 'bg-zinc-300 dark:bg-zinc-600' },
  unknown: { label: t('unbekannt'), dot: 'bg-zinc-300' },
}
