// Files from chats on iOS / Android (web and desktop: files.web.ts). The file comes over the
// connection into the media cache once (media.ts), like images; download hands it on from there:
// iOS → the share sheet (Save to Files, AirDrop, other apps), Android → a folder the user picks.
import { Platform, Share } from 'react-native'
import { Directory, File } from 'expo-file-system'
import type { FileInfo } from '@shared/types'
import { mediaFile } from './connection'
import { toast } from './store'
import { t } from './i18n'

export const downloadUrl = (f: FileInfo) => `${f.url}&download=1`

/** A local file URI an <Image>, player or WebView can load. */
export const previewSource = (f: FileInfo, _kind: string) => mediaFile(f.url)

export async function downloadFile(f: FileInfo): Promise<void> {
  const uri = await mediaFile(downloadUrl(f))
  if (Platform.OS === 'ios') {
    await Share.share({ url: uri, title: f.name })
    return
  }
  const dir = await Directory.pickDirectoryAsync()
  const target = dir.createFile(f.name, f.mime || 'application/octet-stream')
  target.write(await new File(uri).bytes())
  toast(t('Gespeichert'), 'success', null, f.name)
}

export const canOpenInSystem = () => false
export const openInSystem = async (_f: FileInfo) => false
