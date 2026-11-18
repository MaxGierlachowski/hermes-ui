// Same texts as the web UI: German source strings are the keys, English (shared/i18n-en.ts) the translation.
import { EN } from '@shared/i18n-en'

export type Lang = 'de' | 'en'
const deviceLocale = (() => { try { return Intl.DateTimeFormat().resolvedOptions().locale || 'en' } catch { return 'en' } })()
export const lang: Lang = deviceLocale.toLowerCase().startsWith('de') ? 'de' : 'en'

export function t(key: string, vars: Record<string, string | number> = {}) {
  const s = lang === 'de' ? key : (EN[key] ?? key)
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

export function relTime(ts?: number) {
  if (!ts) return ''
  const d = Date.now() / 1000 - ts
  if (d < 60) return t('gerade')
  if (d < 3600) return `${Math.floor(d / 60)} min`
  if (d < 86400) return `${Math.floor(d / 3600)} h`
  return new Date(ts * 1000).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit' })
}
export const clock = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '')
