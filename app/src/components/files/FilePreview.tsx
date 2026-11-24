// Preview of a file from a chat: a modal on the desktop, full screen on phones. Header with name, path
// (copyable), Download, "Open in system" (desktop app with a local backend) and close (Esc). ⌘S / Ctrl+S
// downloads. What it shows depends on the type (shared/file-refs.ts previewKind):
//
//   image → the image · audio → the player · video, PDF → the platform's viewer (viewers.tsx)
//   Markdown → rendered · CSV/TSV → a table (if it parses) · text and code → highlighted source
//   (HTML and SVG too: never rendered) · anything else, or too large → a file card with Download.
//
// Text comes as JSON from /api/sessions/:id/file/text (first MB); everything else through the
// connection's media path (cached), so it works the same locally and over iroh.
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { AlertTriangle, Copy, Download, ExternalLink, X } from 'lucide-react-native'
import type { FileInfo } from '@shared/types'
import { codeLanguage, formatBytes, parseCsv, previewKind, extOf, type FilePreviewKind } from '@shared/file-refs'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { Button, BUTTON_ICON } from '@/components/ui/button'
import { CodeBlock } from '@/components/CodeBlock'
import { Markdown } from '@/components/Markdown'
import { MediaAudio } from '@/components/Media'
import { api } from '@/lib/connection'
import { canOpenInSystem, downloadFile, openInSystem, previewSource } from '@/lib/files'
import { copyText } from '@/lib/clipboard'
import { useLayer } from '@/lib/nav'
import { toast } from '@/lib/store'
import { clock, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { isWebDesktop as D } from '@/lib/web-input'
import { canShowPdf, canShowVideo, PdfView, VideoView } from './viewers'
import { fileIcon } from './FileChip'

type TextReply = { text?: string; truncated?: boolean; size: number; binary?: boolean }
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' })
// Highlighting tokenises into nested Text per token: fine for source files, too slow for megabytes.
const HIGHLIGHT_MAX = 200_000

const textUrl = (f: FileInfo) => f.url.replace('/file?', '/file/text?')

function useSource(f: FileInfo, kind: FilePreviewKind) {
  const [state, setState] = useState<{ uri: string | null; error: boolean }>({ uri: null, error: false })
  useEffect(() => {
    let alive = true
    setState({ uri: null, error: false })
    previewSource(f, kind).then((uri) => alive && setState({ uri, error: false }), () => alive && setState({ uri: null, error: true }))
    return () => { alive = false }
  }, [f.url, kind])
  return state
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center p-6">{children}</View>
}

function Failed({ text }: { text: string }) {
  return (
    <Centered>
      <Icon as={AlertTriangle} size={22} tone="muted-foreground" />
      <Text className="mt-2 text-center text-sm text-muted-foreground">{text}</Text>
    </Centered>
  )
}

/** The fallback: what the file is, and the way to get it. */
function InfoCard({ f, reason, onDownload }: { f: FileInfo; reason: string; onDownload: () => void }) {
  const rows: [string, string][] = [
    [t('Größe'), formatBytes(f.size)],
    [t('Typ'), f.mime || extOf(f.name).toUpperCase()],
    [t('Geändert'), clock(f.mtime)],
  ]
  return (
    <ScrollView contentContainerClassName="flex-grow items-center justify-center p-6">
      <View className="w-full max-w-sm items-center gap-3 rounded-2xl border border-border bg-card p-6">
        <View className="h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-muted"><Icon as={fileIcon(f.name)} size={26} tone="muted-foreground" /></View>
        <Text className="text-center text-base font-semibold" numberOfLines={2}>{f.name}</Text>
        <View className="w-full gap-1.5">
          {rows.map(([k, v]) => (
            <View key={k} className="flex-row justify-between gap-4">
              <Text className="text-sm text-muted-foreground">{k}</Text>
              <Text selectable className="shrink text-right text-sm" numberOfLines={1}>{v}</Text>
            </View>
          ))}
        </View>
        <Text className="text-center text-xs text-muted-foreground">{reason}</Text>
        <Button variant="outline" onPress={onDownload} accessibilityLabel={t('Herunterladen')}>
          <Icon as={Download} size={BUTTON_ICON} /><Text>{t('Herunterladen')}</Text>
        </Button>
      </View>
    </ScrollView>
  )
}

function CsvTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows
  const cell = (v: string, i: number, bold: boolean) => (
    <View key={i} className="w-40 border-r border-border px-2 py-1.5">
      <Text selectable numberOfLines={3} className={cn('text-xs', bold && 'font-semibold')}>{v}</Text>
    </View>
  )
  return (
    <ScrollView horizontal contentContainerClassName="p-4">
      <View className="self-start overflow-hidden rounded-lg border border-border">
        <View className="flex-row border-b border-border bg-muted">{head.map((v, i) => cell(v, i, true))}</View>
        {body.map((r, j) => <View key={j} className={cn('flex-row', j < body.length - 1 && 'border-b border-border')}>{r.map((v, i) => cell(v, i, false))}</View>)}
      </View>
    </ScrollView>
  )
}

function TextBody({ f, kind }: { f: FileInfo; kind: FilePreviewKind }) {
  const [reply, setReply] = useState<TextReply | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    api<TextReply>(textUrl(f)).then((r) => alive && setReply(r), () => alive && setError(true))
    return () => { alive = false }
  }, [f.url])
  const csv = useMemo(() => (kind === 'csv' && reply?.text ? parseCsv(reply.text, { tab: extOf(f.name) === 'tsv' }) : null), [reply, kind])
  if (error) return <Failed text={t('Datei konnte nicht geladen werden')} />
  if (!reply) return <Centered><ActivityIndicator /></Centered>
  if (reply.binary || reply.text === undefined) return <Failed text={t('Keine Textdatei')} />
  const note = reply.truncated && (
    <View className="border-b border-border bg-muted/60 px-4 py-2">
      <Text className="text-xs text-muted-foreground">{t('Vorschau gekürzt auf die ersten {shown} von {size}. Vollständig per Download.', { shown: formatBytes(reply.text.length), size: formatBytes(reply.size) })}</Text>
    </View>
  )
  if (csv && csv.rows.length > 1) {
    return (
      <View className="flex-1">
        {note}
        <ScrollView className="flex-1">
          <CsvTable rows={csv.rows} />
          {csv.more && <Text className="px-4 pb-4 text-xs text-muted-foreground">{t('Die ersten {n} Zeilen.', { n: csv.rows.length })}</Text>}
        </ScrollView>
      </View>
    )
  }
  return (
    <View className="flex-1">
      {note}
      <ScrollView className="flex-1" contentContainerClassName={kind === 'markdown' ? 'px-5 py-3' : 'px-3 py-1'}>
        {kind === 'markdown'
          ? <View className="w-full max-w-3xl self-center"><Markdown text={reply.text} /></View>
          : reply.text.length <= HIGHLIGHT_MAX
            ? <CodeBlock code={reply.text} language={codeLanguage(f.name)} />
            : <Text selectable style={{ fontFamily: MONO, fontSize: 12, lineHeight: 18 }} className="p-3">{reply.text}</Text>}
      </ScrollView>
    </View>
  )
}

function MediaBody({ f, kind }: { f: FileInfo; kind: 'image' | 'video' | 'pdf' }) {
  const { uri, error } = useSource(f, kind)
  if (error) return <Failed text={t('Datei konnte nicht geladen werden')} />
  if (!uri) return <Centered><ActivityIndicator /></Centered>
  if (kind === 'pdf') return <PdfView uri={uri} title={f.name} />
  if (kind === 'video') return <View className="flex-1 bg-black"><VideoView uri={uri} /></View>
  return <View className="flex-1 p-4"><Image source={{ uri }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={f.name} /></View>
}

function Body({ f, onDownload }: { f: FileInfo; onDownload: () => void }) {
  const kind = previewKind(f.name)
  const none = t('Für diesen Dateityp gibt es keine Vorschau.')
  if (kind === 'other') return <InfoCard f={f} reason={none} onDownload={onDownload} />
  if (!f.preview) return <InfoCard f={f} reason={t('Zu groß für eine Vorschau.')} onDownload={onDownload} />
  if (kind === 'audio') return <Centered><View className="w-full max-w-sm items-center gap-4"><Icon as={fileIcon(f.name)} size={32} tone="muted-foreground" /><MediaAudio url={f.url} /></View></Centered>
  if ((kind === 'pdf' && !canShowPdf) || (kind === 'video' && !canShowVideo)) return <InfoCard f={f} reason={none} onDownload={onDownload} />
  if (kind === 'image' || kind === 'video' || kind === 'pdf') return <MediaBody f={f} kind={kind} />
  return <TextBody f={f} kind={kind} />
}

export function FilePreview({ file, onClose }: { file: FileInfo | null; onClose: () => void }) {
  useLayer(!!file)
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const [busy, setBusy] = useState(false)
  const modal = D && win.width >= 720
  const local = canOpenInSystem()

  const download = async () => {
    if (!file || busy) return
    setBusy(true)
    try { await downloadFile(file) } catch (e) { toast(t('Download fehlgeschlagen'), 'error', null, e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  // ⌘S / Ctrl+S downloads while the preview is open (web and desktop).
  useEffect(() => {
    if (!file || Platform.OS !== 'web') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); download() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [file, busy])

  if (!file) return null
  const iconSize = modal ? 16 : 20
  const header = (
    <View className={cn('flex-row items-center gap-2 border-b border-border', modal ? 'px-3 py-2' : 'px-2 pb-2')} style={modal ? undefined : { paddingTop: insets.top + 6 }}>
      <View className="h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-muted"><Icon as={fileIcon(file.name)} size={16} tone="muted-foreground" /></View>
      <View className="min-w-0 flex-1">
        <Text className={cn('font-semibold', modal ? 'text-sm' : 'text-[15px]')} numberOfLines={1} selectable>{file.name}</Text>
        <Pressable onPress={() => copyText(file.path)} accessibilityRole="button" accessibilityLabel={t('Pfad kopieren')} {...({ dataSet: { tip: t('Pfad kopieren') } } as object)} className={cn('max-w-full flex-row items-center gap-1 self-start', !D && 'min-h-6')}>
          <Text className="shrink font-mono text-[11px] text-muted-foreground" numberOfLines={1} ellipsizeMode="middle">{file.path}</Text>
          <Icon as={Copy} size={11} tone="muted-foreground" />
        </Pressable>
      </View>
      {modal ? (
        <Button variant="outline" size="sm" onPress={download} disabled={busy} accessibilityLabel={t('Herunterladen')} {...({ dataSet: { tip: `${t('Herunterladen')}  ⌘S` } } as object)}>
          {busy ? <ActivityIndicator size="small" /> : <Icon as={Download} size={14} />}<Text>{t('Herunterladen')}</Text>
        </Button>
      ) : (
        <Button variant="ghost" size="icon" onPress={download} disabled={busy} accessibilityLabel={t('Herunterladen')}>
          {busy ? <ActivityIndicator size="small" /> : <Icon as={Download} size={iconSize} />}
        </Button>
      )}
      {local && (
        <Button variant="ghost" size={modal ? 'icon-sm' : 'icon'} onPress={() => openInSystem(file)} accessibilityLabel={t('Im System öffnen')}>
          <Icon as={ExternalLink} size={iconSize} />
        </Button>
      )}
      <Button variant="ghost" size={modal ? 'icon-sm' : 'icon'} onPress={onClose} accessibilityLabel={t('Schließen')} {...({ dataSet: { tip: `${t('Schließen')}  Esc` } } as object)}>
        <Icon as={X} size={iconSize} />
      </Button>
    </View>
  )
  const meta = (
    <View className="flex-row flex-wrap gap-x-3 border-b border-border px-4 py-1.5">
      <Text className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</Text>
      <Text className="text-[11px] text-muted-foreground">{file.mime}</Text>
      <Text className="text-[11px] text-muted-foreground">{t('geändert {when}', { when: clock(file.mtime) })}</Text>
    </View>
  )
  const panel = (
    <View className={cn('overflow-hidden bg-background', modal ? 'rounded-xl border border-border' : 'flex-1')}
      style={modal ? { width: Math.min(1040, win.width - 64), height: Math.min(860, win.height - 64) } : { paddingBottom: insets.bottom }}
      {...({ dataSet: { testid: 'file-preview' } } as object)}>
      {header}
      {meta}
      <View className="min-h-0 flex-1"><Body key={file.url} f={file} onDownload={download} /></View>
    </View>
  )
  return (
    <Modal visible transparent={modal} animationType={modal ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {modal ? (
        <View className="flex-1 items-center justify-center">
          <Pressable className="absolute inset-0 bg-black/50" onPress={onClose} accessible={false} />
          {panel}
        </View>
      ) : panel}
    </Modal>
  )
}
