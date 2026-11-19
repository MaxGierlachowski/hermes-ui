import { useState } from 'react'
import { memo } from 'react'
import { RefreshControl, View, Pressable } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { router } from 'expo-router'
import { Bot, CheckCheck, CircleAlert, CircleCheck, ShieldAlert } from 'lucide-react-native'
import type { InboxItem, OpenItem } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { PendingPrompt } from './PendingPrompt'
import { kindLabel, loadInbox, markRead, openThread, respondPaseo, useStore } from '@/lib/store'
import { relTime, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function OpenCard({ item }: { item: OpenItem }) {
  const [busy, setBusy] = useState(false)
  const go = () => { if (item.sessionId) { openThread(item.sessionId); router.push(`/thread/${encodeURIComponent(item.sessionId)}`) } }
  if (item.source === 'hermes') {
    return (
      <View className="gap-2">
        <Pressable onPress={go}><Text className="text-sm font-medium text-muted-foreground" numberOfLines={1}>{item.title || 'Hermes'} · {relTime(item.at)}</Text></Pressable>
        <PendingPrompt sessionId={item.sessionId} prompt={item.prompt} />
      </View>
    )
  }
  const p = item.permission
  return (
    <View className="gap-3 rounded-xl border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/5 p-3">
      <View className="flex-row items-center gap-1.5">
        <Icon as={Bot} size={15} color="#d97706" />
        <Text className="flex-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300" numberOfLines={1}>{t('Paseo-Agent braucht eine Freigabe')}</Text>
      </View>
      <Text className="text-[15px] font-medium">{item.agent.title || item.agent.id.slice(0, 8)}</Text>
      {!!(p.title || p.description) && <Text className="text-sm text-muted-foreground">{p.title || p.description}</Text>}
      {!!p.command && <Text selectable className="rounded-md bg-background/80 p-2 font-mono text-xs">{p.command}</Text>}
      {item.canRespond ? (
        <View className="flex-row gap-2">
          <Button className="flex-1" disabled={busy} onPress={async () => { setBusy(true); await respondPaseo(item.agent.id, p.id, 'allow'); setBusy(false) }}><Text>{t('Erlauben')}</Text></Button>
          <Button variant="outline" className="flex-1" disabled={busy} onPress={async () => { setBusy(true); await respondPaseo(item.agent.id, p.id, 'deny'); setBusy(false) }}><Text>{t('Ablehnen')}</Text></Button>
        </View>
      ) : <Text className="text-xs text-muted-foreground">{t('Antworten nur in Paseo möglich')}</Text>}
    </View>
  )
}

const ITEM_ICON = (k: InboxItem['kind']) => (k.endsWith('error') || k === 'paseo-limit' ? CircleAlert : k === 'approval' || k === 'permission' ? ShieldAlert : CircleCheck)

const HistoryRow = memo(function HistoryRow({ item }: { item: InboxItem }) {
  return (
    <Pressable
      onPress={() => { markRead([item.id]); if (item.sessionId) { openThread(item.sessionId); router.push(`/thread/${encodeURIComponent(item.sessionId)}`) } }}
      className="min-h-14 flex-row items-start gap-3 border-b border-border px-1 py-3 active:bg-accent"
    >
      <Icon as={ITEM_ICON(item.kind)} size={18} tone={item.kind.endsWith('error') ? 'destructive' : 'muted-foreground'} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className={cn('flex-1 text-sm', !item.read && 'font-semibold')} numberOfLines={1}>{kindLabel(item.kind)} · {item.source === 'paseo' && item.agentTitle ? item.agentTitle : item.title || 'Hermes'}</Text>
          <Text className="text-xs text-muted-foreground">{relTime(item.at)}</Text>
        </View>
        {!!item.text && <Text className="text-[13px] text-muted-foreground" numberOfLines={2}>{item.text}</Text>}
        {item.resolution && <Text className="text-xs text-muted-foreground/80">✓ {item.resolution.choice || item.resolution.decision || item.resolution.answer || item.resolution.by}</Text>}
      </View>
      {!item.read && <View className="mt-1.5 h-2 w-2 rounded-full bg-primary" />}
    </Pressable>
  )
})

export function Inbox() {
  const inbox = useStore((s) => s.inbox)
  const [refreshing, setRefreshing] = useState(false)
  return (
    <FlashList
      data={inbox.items}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 128 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadInbox(); setRefreshing(false) }} />}
      ListHeaderComponent={
        <View className="gap-4 pb-2 pt-1">
          {inbox.open.length > 0 && <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Offen')} ({inbox.open.length})</Text>}
          {inbox.open.map((o) => <OpenCard key={o.key} item={o} />)}
          <View className="flex-row items-center justify-between pt-2">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Verlauf')}</Text>
            {inbox.unread > 0 && (
              <Button variant="ghost" size="sm" onPress={() => markRead('all')}><Icon as={CheckCheck} size={16} /><Text className="text-sm">{t('Alle gelesen')}</Text></Button>
            )}
          </View>
        </View>
      }
      ListEmptyComponent={inbox.loaded ? <Text className="py-10 text-center text-muted-foreground">{t('Noch nichts da.')}</Text> : undefined}
      renderItem={({ item }) => <HistoryRow item={item} />}
    />
  )
}
