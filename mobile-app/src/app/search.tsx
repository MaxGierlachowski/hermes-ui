import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft } from 'lucide-react-native'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { StatusDot } from '@/components/status'
import { openThread, searchChats, type SearchHit } from '@/lib/store'
import { relTime, t } from '@/lib/i18n'

/** Full-text search over titles and message content (backend /api/search, Hermes' FTS index). */
export default function Search() {
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setHits([]); return }
    const n = ++seq.current
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await searchChats(query)
        if (n !== seq.current) return
        const seen = new Set<string>()
        setHits([...r.title, ...r.content].filter((h) => !seen.has(h.session.id) && seen.add(h.session.id)))
      } catch { /* shown as empty */ } finally { if (n === seq.current) setBusy(false) }
    }, 250)
    return () => clearTimeout(timer)
  }, [q])
  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-1 border-b border-border px-1 pb-2" style={{ paddingTop: insets.top + 4 }}>
        <Button variant="ghost" size="icon" onPress={() => router.back()} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>
        <Input className="mr-2 flex-1" value={q} onChangeText={setQ} placeholder={t('Chats, Inhalte oder Befehle suchen …')} autoFocus returnKeyType="search" />
      </View>
      {busy && <ActivityIndicator className="mt-4" />}
      <FlatList
        data={hits}
        keyExtractor={(h) => h.session.id}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-4 pb-10"
        ListEmptyComponent={q.trim().length >= 2 && !busy ? <Text className="py-10 text-center text-muted-foreground">{t('Nichts gefunden für „{q}“.', { q: q.trim() })}</Text> : undefined}
        renderItem={({ item: h }) => (
          <Pressable onPress={() => { openThread(h.session.id); router.replace(`/thread/${encodeURIComponent(h.session.id)}`) }} className="min-h-14 gap-1 border-b border-border py-3 active:bg-accent">
            <View className="flex-row items-center gap-2">
              <StatusDot column={h.session.column} />
              <Text className="flex-1 text-[15px] font-medium" numberOfLines={1}>{h.session.title || t('Ohne Titel')}</Text>
              <Text className="text-xs text-muted-foreground">{relTime(h.session.updatedAt)}</Text>
            </View>
            {h.hit && <Text className="text-[13px] text-muted-foreground" numberOfLines={2}>{h.hit.snippet.replace(/[\u0002\u0003]/g, '')}</Text>}
          </Pressable>
        )}
      />
    </View>
  )
}
