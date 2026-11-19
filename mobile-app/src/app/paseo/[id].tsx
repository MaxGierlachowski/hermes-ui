import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Bot, ChevronRight, ListTodo, TriangleAlert, Wrench } from 'lucide-react-native'
import type { PaseoAgent, PaseoItem } from '@shared/types'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Markdown } from '@/components/Markdown'
import { AGENT_STATE } from '@/components/status'
import { paseoAgents, paseoTimeline } from '@/lib/store'
import { cn } from '@/lib/utils'
import { relTime, t } from '@/lib/i18n'

const REL: Record<string, string> = { created: 'gestartet', steers: 'gesteuert', watches: 'beobachtet' }

function AgentRow({ a, onPress }: { a: PaseoAgent; onPress: () => void }) {
  const st = AGENT_STATE[a.state] || AGENT_STATE.unknown
  return (
    <Pressable onPress={onPress} className={cn('min-h-16 flex-row items-center gap-3 border-b border-border py-3 active:bg-accent', a.archived && 'opacity-50')}>
      <Icon as={Bot} size={20} tone="muted-foreground" />
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-medium" numberOfLines={1}>{a.title || a.id.slice(0, 8)}</Text>
        <View className="flex-row items-center gap-1.5">
          <View className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
          <Text className={cn('text-xs text-muted-foreground', st.text)} numberOfLines={1}>{st.label} · {t(REL[a.rel] || a.rel)}{a.account ? ` · ${a.account}` : ''}{a.updatedAt ? ` · ${relTime(Date.parse(a.updatedAt) / 1000)}` : ''}</Text>
        </View>
        {!!a.goal && <Text className="text-xs text-muted-foreground" numberOfLines={2}>{t('Ziel')}: {a.goal}</Text>}
      </View>
      <Icon as={ChevronRight} size={16} tone="muted-foreground" />
    </Pressable>
  )
}

function ItemView({ it }: { it: PaseoItem }) {
  const [open, setOpen] = useState(false)
  if (it.role === 'user') return <View className="items-end"><View className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2"><Text selectable className="text-[15px]">{it.text}</Text></View></View>
  if (it.role === 'assistant') return <Markdown text={it.text || ''} />
  if (it.role === 'tool') {
    return (
      <View className="items-start">
        <Pressable onPress={() => setOpen((o) => !o)} className="min-h-9 max-w-full flex-row items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5">
          <Icon as={Wrench} size={12} tone="muted-foreground" />
          <Text className="font-mono text-xs text-muted-foreground">{it.toolName}</Text>
          {!!it.summary && <Text className="shrink text-xs text-muted-foreground/80" numberOfLines={1}>· {it.summary}</Text>}
        </Pressable>
        {open && !!it.text && <Text selectable className="mt-1.5 w-full rounded-md bg-muted/60 p-2 font-mono text-[11.5px]">{it.text}</Text>}
      </View>
    )
  }
  if (it.role === 'todo') {
    return (
      <View className="gap-1 rounded-lg border border-border p-3">
        <View className="flex-row items-center gap-1.5"><Icon as={ListTodo} size={14} tone="muted-foreground" /><Text className="text-xs font-semibold text-muted-foreground">Todos</Text></View>
        {it.todos?.map((td, i) => <Text key={i} className={cn('text-sm', td.done && 'text-muted-foreground line-through')}>{td.done ? '☑' : '☐'} {td.text}</Text>)}
      </View>
    )
  }
  return (
    <View className="flex-row items-start gap-2">
      {it.role === 'error' && <Icon as={TriangleAlert} size={14} tone="destructive" />}
      <Text className={cn('flex-1 text-xs', it.role === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{it.text}</Text>
    </View>
  )
}

/** Paseo agents of a session and their read-only transcripts (no input, nothing that changes an agent). */
export default function PaseoScreen() {
  const { id, agent: agentParam } = useLocalSearchParams<{ id: string; agent?: string }>()
  const insets = useSafeAreaInsets()
  const [agents, setAgents] = useState<PaseoAgent[] | null>(null)
  const [agentId, setAgentId] = useState<string | null>(agentParam || null)
  const [items, setItems] = useState<PaseoItem[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadAgents = useCallback(async () => { try { setAgents((await paseoAgents(decodeURIComponent(id))).agents) } catch { setAgents([]) } }, [id])
  const loadTimeline = useCallback(async (aid: string) => { try { setItems((await paseoTimeline(aid)).items) } catch { setItems([]) } }, [])
  useEffect(() => { loadAgents() }, [loadAgents])
  useEffect(() => {
    if (!agentId) return
    setItems(null)
    loadTimeline(agentId)
    const running = agents?.find((a) => a.id === agentId)?.state === 'running'
    if (!running) return
    const timer = setInterval(() => loadTimeline(agentId), 3000)
    return () => clearInterval(timer)
  }, [agentId, agents?.length])

  const agent = agents?.find((a) => a.id === agentId)
  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-1 border-b border-border px-1 pb-1" style={{ paddingTop: insets.top + 2 }}>
        <Button variant="ghost" size="icon" onPress={() => (agentId && !agentParam ? setAgentId(null) : router.back())} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>
        <Text className="flex-1 text-[16px] font-semibold" numberOfLines={1}>{agent ? agent.title || agent.id.slice(0, 8) : t('Paseo-Agents')}</Text>
      </View>
      {!agentId ? (
        agents === null ? <ActivityIndicator className="mt-10" /> : (
          <FlatList
            data={[...agents].sort((a, b) => Number(a.archived) - Number(b.archived))}
            keyExtractor={(a) => a.id}
            contentContainerClassName="px-4 pb-10"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadAgents(); setRefreshing(false) }} />}
            renderItem={({ item }) => <AgentRow a={item} onPress={() => setAgentId(item.id)} />}
            ListEmptyComponent={<Text className="py-10 text-center text-muted-foreground">{t('Keine Paseo-Agents.')}</Text>}
          />
        )
      ) : items === null ? <ActivityIndicator className="mt-10" /> : (
        <FlatList
          inverted
          data={[...items].reverse()}
          keyExtractor={(_, i) => String(i)}
          contentContainerClassName="gap-3 px-4 py-4"
          renderItem={({ item }) => <ItemView it={item} />}
          ListEmptyComponent={<Text className="py-10 text-center text-muted-foreground">{t('Noch nichts da.')}</Text>}
        />
      )}
    </View>
  )
}
