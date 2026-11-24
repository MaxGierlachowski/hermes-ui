// How files from chats appear in a thread: a quiet chip inside the text (file icon + name, the full path
// as tooltip; long press copies it on touch screens) and a card under a reply for MEDIA attachments and
// the files of a tool call. Both open the preview (FilePreview.tsx) through FileOpenContext.
import { createContext, useContext } from 'react'
import { Platform, Pressable, Text as RNText, View } from 'react-native'
import { useColorScheme } from 'nativewind'
import { File as FileIcon, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from 'lucide-react-native'
import type { FileInfo } from '@shared/types'
import { extOf, formatBytes, previewKind } from '@shared/file-refs'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { THEME } from '@/lib/theme'
import { copyText } from '@/lib/clipboard'
import { haptic } from '@/lib/haptics'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { isWebDesktop as D } from '@/lib/web-input'

/** Opens a file in the preview; provided by the thread (ThreadPane). */
export const FileOpenContext = createContext<(f: FileInfo) => void>(() => {})
/** The confirmed files of the message being rendered (Markdown's hermesfile:N links index into it). */
export const MessageFilesContext = createContext<FileInfo[]>([])

const ARCHIVES = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'])

export function fileIcon(name: string): LucideIcon {
  const kind = previewKind(name)
  if (kind === 'image') return FileImage
  if (kind === 'audio') return FileAudio
  if (kind === 'video') return FileVideo
  if (kind === 'csv') return FileSpreadsheet
  if (kind === 'markdown' || kind === 'pdf') return FileText
  if (kind === 'text') return extOf(name) === 'txt' || extOf(name) === 'log' ? FileText : FileCode
  return ARCHIVES.has(extOf(name)) ? FileArchive : FileIcon
}

const tip = (f: FileInfo) => (D ? ({ dataSet: { tip: f.path } } as object) : {})

/** Inline chip for a Markdown link `[label](hermesfile:N)` (shared/file-refs.ts linkFileRefs). */
export function FileLinkChip({ index, children }: { index: number; children: React.ReactNode }) {
  const files = useContext(MessageFilesContext)
  const open = useContext(FileOpenContext)
  const { colorScheme } = useColorScheme()
  const c = THEME[colorScheme === 'dark' ? 'dark' : 'light']
  const f = files[index]
  if (!f) return <RNText>{children}</RNText>
  const web = Platform.OS === 'web'
  return (
    // A nested Text, so it flows with the sentence; the web gets a bordered pill, native a tinted span.
    <RNText
      accessibilityRole="link"
      accessibilityLabel={t('Datei {name} öffnen', { name: f.name })}
      onPress={() => { haptic('select'); open(f) }}
      onLongPress={() => { haptic('select'); copyText(f.path) }}
      {...({ dataSet: { ...(D ? { tip: f.path } : {}), hkFile: '' } } as object)}
      style={[
        { color: c.foreground, fontWeight: '500', textDecorationLine: 'none' },
        web
          ? ({ paddingLeft: 5, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.muted, cursor: 'pointer', whiteSpace: 'nowrap' } as object)
          : { backgroundColor: c.muted },
      ]}
    >
      {web
        // An inline box: a bare svg (or a View) inside a span breaks the line on react-native-web.
        ? <View style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 4 } as object}><Icon as={fileIcon(f.name)} size={D ? 13 : 14} tone="muted-foreground" /></View>
        : <Icon as={fileIcon(f.name)} size={14} tone="muted-foreground" />}
      {web ? '' : ' '}{typeof children === 'string' ? children.replace(/\\(.)/g, '$1') : children}
    </RNText>
  )
}

/** A file as a card (MEDIA attachments of non-media files, a tool call's files). At least 44 px high. */
export function FileCard({ f, name }: { f?: FileInfo; name: string }) {
  const open = useContext(FileOpenContext)
  const meta = f ? [formatBytes(f.size), extOf(f.name).toUpperCase()].filter(Boolean).join(' · ') : t('nicht verfügbar')
  return (
    <Pressable
      disabled={!f}
      onPress={() => { if (f) { haptic('select'); open(f) } }}
      onLongPress={() => { if (f) { haptic('select'); copyText(f.path) } }}
      accessibilityRole="button"
      accessibilityLabel={t('Datei {name} öffnen', { name })}
      {...(f ? tip(f) : {})}
      className={cn('min-h-11 max-w-full flex-row items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2', f && 'active:bg-accent web:transition-colors web:hover:border-foreground/20', D ? 'w-72' : 'w-64')}
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-muted"><Icon as={fileIcon(name)} size={16} tone="muted-foreground" /></View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium" numberOfLines={1}>{name}</Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>{meta}</Text>
      </View>
    </Pressable>
  )
}
