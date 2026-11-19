import * as Clipboard from 'expo-clipboard'
import { toast } from './store'
import { t } from './i18n'

/** Copies text and confirms with a toast. */
export async function copyText(text: string) {
  try { await Clipboard.setStringAsync(text); toast(t('Kopiert'), 'success') } catch { toast(t('Kopieren fehlgeschlagen'), 'error') }
}
