import { memo } from 'react'
import { Pressable, View } from 'react-native'
import { Bot, CircleHelp, FlaskConical, MessageSquare, Pin, ShieldAlert } from 'lucide-react-native'
import type { PaseoChip, Session } from '@shared/types'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { AGENT_STATE, StatusDot, sourceIcon } from './status'
import { cn } from '@/lib/utils'
import { relTime, t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

function AgentChip({ a }: { a: PaseoChip }) {
  const st = AGENT_STATE[a.state] || AGENT_STATE.unknown
  return (
    <View className={cn('max-w-full flex-row items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5', a.archived && 'opacity-50')}>
      <Icon as={Bot} size={12} tone="muted-foreground" />
      <View className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
      <Text className={cn('text-[11px] text-muted-foreground', st.text)} numberOfLines={1}>{a.title || a.id.slice(0, 8)}</Text>
    </View>
  )
}

/** One chat as a card (web: board/SessionCard.tsx). */
export const SessionCard = memo(function SessionCard({ s, onPress, onLongPress }: { s: Session; onPress: () => void; onLongPress?: () => void }) {
  const pending = s.pending?.[0]
  const active = s.paseo?.filter((a) => !a.archived && a.rel !== 'watches') ?? []
  const SourceIcon = sourceIcon(s.source)
  return (
    <Pressable
      onPress={() => { haptic('select'); onPress() }}
      onLongPress={onLongPress}
      className={cn('gap-2 rounded-xl border border-border bg-card px-3.5 py-3 active:bg-accent', pending && 'border-l-[3px] border-l-amber-500')}
      accessibilityRole="button"
    >
      <View className="flex-row items-start gap-2.5">
        <StatusDot column={s.column} running={s.running} pending={!!pending} className="mt-1.5" />
        <Text className="flex-1 text-[15px] font-medium leading-snug" numberOfLines={2}>{s.title || t('Ohne Titel')}</Text>
      </View>
      {pending ? (
        <View className="flex-row items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5">
          <Icon as={pending.kind === 'approval' ? ShieldAlert : CircleHelp} size={14} color="#d97706" />
          <Text className="flex-1 text-[13px] text-amber-700 dark:text-amber-300" numberOfLines={2}>
            {pending.kind === 'approval' ? 'Freigabe: ' : t('Rückfrage: ')}
            {pending.kind === 'approval' ? pending.description || pending.command : pending.question}
          </Text>
        </View>
      ) : s.activity ? (
        <Text className={cn('text-[13px] text-muted-foreground', s.running && 'text-foreground/80')} numberOfLines={2}>{s.activity.replace(/^💬\s*/, '')}</Text>
      ) : null}
      {active.length > 0 && (
        <View className="flex-row flex-wrap items-center gap-1">
          {active.slice(0, 3).map((a) => <AgentChip key={a.id} a={a} />)}
          {active.length > 3 && <Text className="text-[11px] text-muted-foreground">+{active.length - 3}</Text>}
        </View>
      )}
      <View className="flex-row items-center gap-2">
        <View className="flex-row items-center gap-1"><Icon as={SourceIcon} size={12} tone="muted-foreground" /><Text className="text-xs text-muted-foreground">{s.source}</Text></View>
        {s.test && <View className="flex-row items-center gap-0.5"><Icon as={FlaskConical} size={12} color="#d97706" /><Text className="text-xs text-amber-600">Test</Text></View>}
        {s.draft && <Text className="rounded border border-border px-1 text-[10px] uppercase text-muted-foreground">{t('Entwurf')}</Text>}
        {s.override && <Icon as={Pin} size={12} tone="primary" />}
        <View className="ml-auto flex-row items-center gap-2">
          {s.messageCount > 0 && <View className="flex-row items-center gap-0.5"><Icon as={MessageSquare} size={12} tone="muted-foreground" /><Text className="text-xs text-muted-foreground">{s.messageCount}</Text></View>}
          <Text className="text-xs text-muted-foreground">{relTime(s.updatedAt)}</Text>
        </View>
      </View>
    </Pressable>
  )
})
