import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, ChevronRight, ListTodo, TriangleAlert, Wrench } from 'lucide-react-native'
import type { PaseoAgent, PaseoItem } from '@shared/types'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Markdown } from '@/components/Markdown'
import { AGENT_STATE } from '@/components/status'
import { cachedPaseoAgents, cachedPaseoTimeline, paseoAgents, paseoTimeline } from '@/lib/store'
import { SyncBar } from '@/components/SyncBar'
import { ThreadList } from '@/components/thread/ThreadList'
import { cn } from '@/lib/utils'
import { relTime, t } from '@/lib/i18n'
import { agentIcon, agentKindLabel, agentMatchNote } from '@/lib/agents'

const REL: Record<string, string> = { created: 'gestartet', steers: 'gesteuert', watches: 'beobachtet' }
const VIA = { label: 'per Label verknüpft', manual: 'von Hand angehängt' } as const

function AgentRow({ a, onPress }: { a: PaseoAgent; onPress: () => void }) {
  const st = AGENT_STATE[a.state] || AGENT_STATE.unknown
  return (
    <Pressable onPress={onPress} className={cn('min-h-16 flex-row items-center gap-3 border-b border-border py-3 active:bg-accent', a.archived && 'opacity-50')}>
      <Icon as={agentIcon(a)} size={20} tone="muted-foreground" />
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-medium" numberOfLines={1}>{a.title || a.id.slice(0, 8)}</Text>
        <View className="flex-row items-center gap-1.5">
          <View className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
          <Text className={cn('text-xs text-muted-foreground', st.text)} numberOfLines={1}>{agentKindLabel(a)} · {st.label} · {t(REL[a.rel] || a.rel)}{a.provider !== 'hermes' && a.account ? ` · ${a.account}` : ''}{a.updatedAt ? ` · ${relTime(Date.parse(a.updatedAt) / 1000)}` : ''}</Text>
        </View>
        {!!a.goal && <Text className="text-xs text-muted-foreground" numberOfLines={2}>{t('Ziel')}: {a.goal}</Text>}
        {!!agentMatchNote(a.match) && <Text className="text-[11px] italic text-muted-foreground">{agentMatchNote(a.match)}</Text>}
        {!!a.successorOf && <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>{t('Nachfolger von {title}', { title: a.predecessorTitle || a.successorOf.slice(0, 8) })}</Text>}
        {!!a.via && a.via !== 'successor' && <Text className="text-[11px] italic text-muted-foreground">{t(VIA[a.via])}</Text>}
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

/**
 * Agents of a session (Paseo agents and Hermes' own subagents / terminal runs) and their read-only
 * transcripts (no input, nothing that changes an agent).
 * A screen on the phone (app/paseo/[id].tsx), the split pane on the desktop (embedded).
 */
export function PaseoPane({ id, agent: agentParam, embedded = false, onBack }: { id: string; agent?: string; embedded?: boolean; onBack: () => void }) {
  const insets = useSafeAreaInsets()
  // Cached agents and transcripts render at once; fresh ones replace them when they arrive.
  const [agents, setAgents] = useState<PaseoAgent[] | null>(() => cachedPaseoAgents(id))
  const [agentId, setAgentId] = useState<string | null>(agentParam || null)
  const [items, setItems] = useState<PaseoItem[] | null>(() => (agentParam ? cachedPaseoTimeline(agentParam) : null))
  const [refreshing, setRefreshing] = useState(false)

  const loadAgents = useCallback(async (quiet = false) => { try { setAgents((await paseoAgents(id, quiet)).agents) } catch { setAgents((a) => a ?? []) } }, [id])
  const loadTimeline = useCallback(async (aid: string, quiet = false) => { try { setItems((await paseoTimeline(aid, quiet)).items) } catch { setItems((x) => x ?? []) } }, [])
  // With a cached copy on screen, refreshes are quiet (no progress bar).
  useEffect(() => { loadAgents(!!cachedPaseoAgents(id)) }, [loadAgents])
  useEffect(() => {
    if (!agentId) return
    const cached = cachedPaseoTimeline(agentId)
    setItems(cached)
    loadTimeline(agentId, !!cached)
    const running = agents?.find((a) => a.id === agentId)?.state === 'running'
    if (!running) return
    const timer = setInterval(() => loadTimeline(agentId, true), 3000)
    return () => clearInterval(timer)
  }, [agentId, agents?.length])

  const agent = agents?.find((a) => a.id === agentId)
  return (
    <View className="flex-1 bg-background">
      <View className={cn('flex-row items-center gap-1 border-b border-border px-1 pb-1', embedded && 'h-12 pb-0')} style={embedded ? undefined : { paddingTop: insets.top + 2 }}>
        <Button variant="ghost" size="icon" onPress={() => (agentId && !agentParam ? setAgentId(null) : onBack())} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>
        <Text className="flex-1 text-[16px] font-semibold" numberOfLines={1}>{agent ? agent.title || agent.id.slice(0, 8) : t('Agents')}</Text>
      </View>
      <SyncBar />
      {!agentId ? (
        agents === null ? <ActivityIndicator className="mt-10" /> : (
          <FlatList
            data={[...agents].sort((a, b) => Number(a.archived) - Number(b.archived))}
            keyExtractor={(a) => a.id}
            contentContainerClassName="px-4 pb-10"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadAgents(); setRefreshing(false) }} />}
            renderItem={({ item }) => <AgentRow a={item} onPress={() => setAgentId(item.id)} />}
            ListEmptyComponent={<Text className="py-10 text-center text-muted-foreground">{t('Keine Agents.')}</Text>}
          />
        )
      ) : items === null ? <ActivityIndicator className="mt-10" /> : items.length === 0 ? (
        <Text className="py-10 text-center text-muted-foreground">{t('Noch nichts da.')}</Text>
      ) : (
        <ThreadList rows={[...items].reverse().map((it, i) => ({ key: `p${items.length - i}`, kind: 'msg', it }))} renderRow={(r) => <ItemView it={r.it} />} />
      )}
    </View>
  )
}
