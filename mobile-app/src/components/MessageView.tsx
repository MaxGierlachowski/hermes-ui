import { memo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { showPaseo } from '@/lib/nav'
import { AlertTriangle, Archive, Bell, Bot, ChevronRight, Clock, CornerDownRight, FileText, RotateCcw, ShieldCheck, Webhook, Wrench, Zap, type LucideIcon } from 'lucide-react-native'
import type { Attachment, PaseoChip, ThreadMessage } from '@shared/types'
import { stripMediaTags } from '@shared/media-tags'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { Markdown } from './Markdown'
import { MediaAudio, MediaImage } from './Media'
import { AGENT_STATE } from './status'
import { retryOutbox } from '@/lib/store'
import { cn } from '@/lib/utils'
import { clock, t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'

function ToolChip({ m }: { m: ThreadMessage }) {
  const [open, setOpen] = useState(false)
  return (
    <View className="items-start">
      <Pressable onPress={() => { if (m.text) { haptic('select'); setOpen((o) => !o) } }} className="min-h-9 max-w-full flex-row items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5">
        <Icon as={Wrench} size={12} tone="muted-foreground" />
        <Text className="font-mono text-xs text-muted-foreground">{m.toolName}</Text>
        {!!m.summary && <Text className="shrink text-xs text-muted-foreground/80" numberOfLines={1}>· {m.summary}</Text>}
        {!!m.text && <Icon as={ChevronRight} size={12} tone="muted-foreground" style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />}
      </Pressable>
      {open && <Text selectable className="mt-1.5 max-h-72 w-full rounded-md bg-muted/60 p-2 font-mono text-[11.5px]">{m.text}</Text>}
    </View>
  )
}

const EVENT_ICON: Record<string, LucideIcon> = { webhook: Webhook, cron: Clock, scheduled: Clock, process: Zap, delegation: Zap }
const EVENT_LABEL: Record<string, string> = { webhook: 'Webhook', cron: 'Cron', scheduled: 'Geplanter Lauf', process: 'Hintergrundprozess', delegation: 'Subagent', compaction: 'Kontext verdichtet' }

function EventCard({ m }: { m: ThreadMessage }) {
  const [open, setOpen] = useState(false)
  const ev = m.event!
  return (
    <View className="rounded-xl border border-border bg-muted/30">
      <Pressable onPress={() => setOpen((o) => !o)} className="min-h-12 flex-row items-start gap-2 px-3 py-2">
        <Icon as={EVENT_ICON[ev.source] || Bell} size={14} tone="muted-foreground" style={{ marginTop: 2 }} />
        <View className="flex-1">
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>{t(EVENT_LABEL[ev.source] || 'Event')}{ev.route ? ` · ${ev.route}` : ''}{m.ts ? `  ·  ${clock(m.ts)}` : ''}</Text>
          <Text className="text-sm font-medium" numberOfLines={2}>{ev.title}</Text>
        </View>
        <Icon as={ChevronRight} size={14} tone="muted-foreground" style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open && !!m.text && <View className="border-t border-border px-3 py-2"><Markdown text={m.text} /></View>}
    </View>
  )
}

function PaseoInline({ m, chips, sessionId }: { m: ThreadMessage; chips: PaseoChip[]; sessionId: string }) {
  const p = m.paseo!
  const chip = p.agentId ? chips.find((c) => c.id === p.agentId) : undefined
  const st = AGENT_STATE[chip?.state || 'unknown'] || AGENT_STATE.unknown
  const title = chip?.title || p.title || p.ref.slice(0, 8)
  const open = () => p.agentId && showPaseo(sessionId, p.agentId)
  if (p.action !== 'create') {
    const ActionIcon = p.action === 'archive' ? Archive : p.action === 'permission' ? ShieldCheck : CornerDownRight
    const what = p.action === 'archive' ? t('Agent „{title}“ archiviert', { title }) : p.action === 'permission' ? t('Freigabe für „{title}“ beantwortet', { title }) : t('Nachricht an „{title}“', { title })
    return (
      <Pressable onPress={open} className="min-h-10 flex-row items-center gap-2 py-1">
        <Icon as={ActionIcon} size={14} tone="muted-foreground" />
        <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={2}>{what}{p.text ? ` – ${p.text}` : ''}</Text>
      </Pressable>
    )
  }
  return (
    <Pressable onPress={open} className="min-h-14 flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 active:bg-accent">
      <Icon as={Bot} size={18} tone="muted-foreground" />
      <View className="flex-1">
        <Text className="text-sm font-medium" numberOfLines={1}>{title}</Text>
        <View className="flex-row items-center gap-1.5">
          <View className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
          <Text className={cn('text-xs text-muted-foreground', st.text)}>Paseo · {st.label}{p.account ? ` · ${p.account}` : ''}</Text>
        </View>
      </View>
      <Icon as={ChevronRight} size={16} tone="muted-foreground" />
    </Pressable>
  )
}

function Attachments({ atts, onImage }: { atts: Attachment[]; onImage: (uri: string) => void }) {
  if (!atts.length) return null
  return (
    <View className="mt-2 items-start gap-2">
      {atts.map((a) => (a.kind === 'image' ? <MediaImage key={a.url} url={a.url} onOpen={onImage} />
        : a.kind === 'audio' ? <MediaAudio key={a.url} url={a.url} />
          : (
            <View key={a.name} className="flex-row items-center gap-1.5 rounded-md border border-border px-2 py-1">
              <Icon as={FileText} size={14} tone="muted-foreground" /><Text className="text-xs text-muted-foreground" numberOfLines={1}>{a.name}</Text>
            </View>
          )))}
    </View>
  )
}

const OUTBOX_LABEL: Record<string, string> = {
  sending: 'wird gesendet …', waiting: 'wartet · läuft nach dem aktuellen Turn', queued: 'wartet · läuft nach dem aktuellen Turn',
  started: 'wird übernommen …', lost: 'nicht übernommen', failed: 'nicht zugestellt',
}

/** One transcript entry (web: ThreadView MessageBody). */
export const MessageView = memo(function MessageView({ m, sessionId, chips, onImage }: { m: ThreadMessage; sessionId: string; chips: PaseoChip[]; onImage: (uri: string) => void }) {
  if (m.role === 'tool') return <ToolChip m={m} />
  if (m.role === 'paseo' && m.paseo) return <PaseoInline m={m} chips={chips} sessionId={sessionId} />
  if (m.role === 'event' && m.event) return <EventCard m={m} />
  const atts = m.attachments || []
  if (m.role === 'user') {
    const o = m.outbox
    const bad = o && (o.status === 'lost' || o.status === 'failed')
    const reply = m.meta?.find((x) => x.kind === 'reply')
    const origin = m.meta?.find((x) => x.kind === 'origin')
    return (
      <View className="items-end">
        {(reply || origin) && <Text className="mb-1 text-[11px] text-muted-foreground" numberOfLines={1}>{reply ? `↳ ${reply.text}` : t('via {where}', { where: origin!.text })}</Text>}
        <View className={cn('max-w-[85%] rounded-2xl rounded-br-md border border-border/60 bg-muted px-3.5 py-2', o && !bad && 'opacity-60', bad && 'border-destructive/50')}>
          {!!m.text && <Text selectable className="text-[15px] leading-[21px]">{m.text}</Text>}
          <Attachments atts={atts} onImage={onImage} />
          {!!m.ts && <Text className="mt-1 text-right text-[11px] text-muted-foreground">{clock(m.ts)}</Text>}
        </View>
        {o && (
          <View className="mt-1 flex-row items-center gap-2">
            {bad && <Icon as={AlertTriangle} size={12} tone="destructive" />}
            <Text className={cn('text-[11px]', bad ? 'text-destructive' : 'text-muted-foreground')}>{t(OUTBOX_LABEL[o.status] || o.status)}</Text>
            {bad && o.id && (
              <Pressable onPress={() => retryOutbox(sessionId, o.id!)} className="h-9 flex-row items-center gap-1 rounded-md border border-border px-3">
                <Icon as={RotateCcw} size={12} /><Text className="text-xs">{t('Erneut senden')}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    )
  }
  if (m.role === 'system') return <Text className="text-center text-xs text-muted-foreground">{m.text}</Text>
  return (
    <View>
      {!!m.text && <Markdown text={m.live ? stripMediaTags(m.text) : m.text} />}
      <Attachments atts={atts} onImage={onImage} />
      {!!m.ts && <Text className="mt-1 text-[11px] text-muted-foreground">{clock(m.ts)}</Text>}
    </View>
  )
})
