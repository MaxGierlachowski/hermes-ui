// One chat: header, messages, open approvals / questions and the composer. A screen on the phone
// (app/thread/[id].tsx), the right half of the split view on the desktop (embedded).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Pressable, View } from 'react-native'
import { useNavigation } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Bot, Check, Columns3, X } from 'lucide-react-native'
import { COLUMNS, type Column, type PaseoChip, type ThreadMessage } from '@shared/types'
import { stripMediaTags } from '@shared/media-tags'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { MessageView } from '@/components/MessageView'
import { Markdown } from '@/components/Markdown'
import { PendingPrompt } from '@/components/PendingPrompt'
import { Composer } from '@/components/Composer'
import { Lightbox } from '@/components/Lightbox'
import { TransitionReady } from '@/components/Media'
import { Sheet } from '@/components/Sheet'
import { SyncBar } from '@/components/SyncBar'
import { COLUMN_COLOR, StatusDot } from '@/components/status'
import { ThreadList, type Row } from './ThreadList'
import { getState, interrupt, openThread, sendMessage, setColumn, useStore } from '@/lib/store'
import { closeThread, showPaseo, showThread } from '@/lib/nav'
import { openMenu } from '@/lib/menu'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

function ColumnSheet({ open, onClose, current, onPick }: { open: boolean; onClose: () => void; current: Column; onPick: (c: Column | 'auto') => void }) {
  return (
    <Sheet open={open} onClose={onClose}>
        <Text className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Spalte')}</Text>
        {COLUMNS.map((c) => (
          <Pressable key={c.id} onPress={() => onPick(c.id)} className="min-h-12 flex-row items-center gap-3 rounded-lg px-2 active:bg-accent">
            <View className={cn('h-2.5 w-2.5 rounded-full', COLUMN_COLOR[c.id])} />
            <Text className="flex-1 text-[15px]">{c.label}</Text>
            {current === c.id && <Icon as={Check} size={18} tone="primary" />}
          </Pressable>
        ))}
        <Pressable onPress={() => onPick('auto')} className="min-h-12 flex-row items-center gap-3 rounded-lg px-2 active:bg-accent">
          <View className="h-2.5 w-2.5" />
          <Text className="flex-1 text-[15px] text-muted-foreground">{t('Automatisch')}</Text>
        </Pressable>
    </Sheet>
  )
}

const NO_CHIPS: PaseoChip[] = []
// Stable keys also for messages without a database id (the cache keeps only the newest ones, so an
// index would shift when the full history arrives).
const rowKey = (m: ThreadMessage) => (m.id != null ? `m${m.id}` : `t${m.ts ?? 0}-${m.role}-${m.text.length}`)

/** True once the screen's open transition has finished (or after 400 ms at the latest). */
function useTransitionDone(embedded: boolean) {
  const navigation = useNavigation()
  const [done, setDone] = useState(embedded)
  useEffect(() => {
    if (embedded) return
    const timer = setTimeout(() => setDone(true), 400)
    const off = navigation.addListener('transitionEnd' as never, () => { clearTimeout(timer); setDone(true) })
    return () => { clearTimeout(timer); off() }
  }, [navigation, embedded])
  return done
}

export function ThreadPane({ sessionId, embedded = false }: { sessionId: string; embedded?: boolean }) {
  const session = useStore((s) => s.sessions[sessionId])
  const openId = useStore((s) => s.openId)
  const messages = useStore((s) => s.messages)
  const loading = useStore((s) => s.loadingThread)
  const streaming = useStore((s) => (s.streaming && s.streaming.id === sessionId ? s.streaming.text : ''))
  const insets = useSafeAreaInsets()
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const columnButton = useRef<ComponentRef<typeof View>>(null)
  const ready = useTransitionDone(embedded)
  const chips = session?.paseo?.length ? session.paseo : NO_CHIPS

  useEffect(() => { if (openId !== sessionId) openThread(sessionId) }, [sessionId])
  // Leaving the thread screen: stop treating it as open (live messages, toasts for its own turns).
  useEffect(() => () => { if (!embedded && getState().openId === sessionId) openThread(null) }, [sessionId, embedded])

  // Newest first: row 0 sits at the bottom, right above the composer.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (session?.pending?.length) out.push({ key: 'prompts', kind: 'prompts' })
    if (streaming) out.push({ key: 'stream', kind: 'stream', text: streaming })
    for (let i = messages.length - 1; i >= 0; i--) out.push({ key: rowKey(messages[i]), kind: 'msg', m: messages[i] })
    return out
  }, [messages, streaming, session?.pending])

  const pickColumn = (c: Column | 'auto') => { haptic('select'); setSheet(false); setColumn(sessionId, c) }
  const columnMenu = () => {
    if (!embedded) { setSheet(true); return }
    columnButton.current?.measureInWindow((x, y, w, h) => {
      openMenu([
        ...COLUMNS.map((c) => ({ id: c.id, text: c.label, checked: session?.column === c.id && session?.override })),
        '-' as const,
        { id: 'auto', text: t('Automatisch'), checked: !session?.override },
      ], { x: x + w, y: y + h, align: 'right' }, (id) => pickColumn(id as Column | 'auto'))
    })
  }

  const agents = session?.paseo?.length || 0
  return (
    <View className="flex-1 bg-background">
      <View className={cn('flex-row items-center gap-1 border-b border-border px-1 pb-1', embedded && 'h-12 px-2 pb-0')} style={embedded ? undefined : { paddingTop: insets.top + 2 }}>
        {!embedded && <Button variant="ghost" size="icon" onPress={closeThread} accessibilityLabel={t('Zurück')}><Icon as={ArrowLeft} /></Button>}
        <View className={cn('flex-1 flex-row items-center gap-2', embedded && 'pl-2')}>
          {session && <StatusDot column={session.column} running={session.running} pending={!!session.pending?.length} />}
          <Text className="flex-1 text-[16px] font-semibold" numberOfLines={1} selectable={embedded}>{session?.title || t('Ohne Titel')}</Text>
        </View>
        {agents > 0 && (
          <Button variant="ghost" size="sm" onPress={() => showPaseo(sessionId)} accessibilityLabel={t('Paseo-Agents')}>
            <Icon as={Bot} size={18} /><Text className="text-sm">{agents}</Text>
          </Button>
        )}
        <View ref={columnButton} collapsable={false}>
          <Button variant="ghost" size="icon" onPress={columnMenu} accessibilityLabel={t('Spalte')}><Icon as={Columns3} size={20} /></Button>
        </View>
        {embedded && <Button variant="ghost" size="icon" onPress={closeThread} accessibilityLabel={t('Schließen')}><Icon as={X} size={20} /></Button>}
      </View>
      <SyncBar />
      <KeyboardAvoidingView behavior="padding" className="flex-1" keyboardVerticalOffset={0} enabled={!embedded}>
        {loading && !messages.length ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : (
          <TransitionReady.Provider value={ready}>
            <ThreadList
              rows={rows}
              renderRow={(item) => item.kind === 'msg'
                ? <MessageView m={item.m} sessionId={sessionId} chips={chips} onImage={setLightbox} />
                : item.kind === 'stream'
                  ? <View className="opacity-90"><Markdown text={stripMediaTags(item.text)} /></View>
                  : <View className="gap-3">{session?.pending.map((p) => <PendingPrompt key={p.promptId} sessionId={sessionId} prompt={p} />)}</View>}
              footer={session?.initialPrompt && !messages.length ? <Text className="text-center text-sm text-muted-foreground">„{session.initialPrompt}“</Text> : undefined}
            />
          </TransitionReady.Provider>
        )}
        <View style={{ paddingBottom: embedded ? 0 : insets.bottom }} className="bg-background">
          <Composer
            key={sessionId}
            draftKey={sessionId}
            autoFocus={embedded}
            running={session?.running}
            onStop={() => interrupt(sessionId)}
            onSend={async (msg) => {
              const next = await sendMessage(sessionId, msg)
              if (next && next !== sessionId) showThread(next, { replace: true })
            }}
          />
        </View>
      </KeyboardAvoidingView>
      {!embedded && <ColumnSheet open={sheet} onClose={() => setSheet(false)} current={session?.column || 'new'} onPick={pickColumn} />}
      <Lightbox uri={lightbox} onClose={() => setLightbox(null)} />
    </View>
  )
}
