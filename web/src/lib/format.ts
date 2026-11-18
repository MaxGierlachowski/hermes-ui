import { t } from './i18n'
export function relTime(ts?: number) {
  if (!ts) return ''
  const d = Date.now() / 1000 - ts
  if (d < 60) return t('gerade')
  if (d < 3600) return `${Math.floor(d / 60)} min`
  if (d < 86400) return `${Math.floor(d / 3600)} h`
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}
export const clock = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '')
export const stripRecommended = (c: string) => c.replace(/\s*\((recommended|empfohlen)\)\s*$/i, '').trim()
