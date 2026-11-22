// UI texts: German source strings are the keys, English is the translation (and the default for
// non-German browsers). Choose with localStorage `hk_lang` = "de" | "en" or the ⌘K palette.

import { EN } from '../../../shared/i18n-en'

export type Lang = 'de' | 'en'
export const lang: Lang = ((): Lang => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('hk_lang') : null
  if (saved === 'de' || saved === 'en') return saved
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'
})()
if (typeof document !== 'undefined') document.documentElement.lang = lang
export function setLang(l: Lang) { localStorage.setItem('hk_lang', l); location.reload() }

export function t(key: string, vars: Record<string, string | number> = {}) {
  const s = lang === 'de' ? key : (EN[key] ?? key)
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}
