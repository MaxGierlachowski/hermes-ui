// Where a tap on a notification leads. The backend's push URLs (FCM data.url, Web Push) and the app's
// own local notifications use the web UI's hash routes:
//   #/board/<session>        the chat
//   #/inbox/<session>        the inbox and the chat (an approval or a question of that chat)
//   #/inbox/item/<entry id>  the inbox at that entry, expanded (an automation without a chat)
//   #/inbox, #/board         the tab
// `item/` is checked before the session: an entry id never ends up opened as a chat.
// No runtime imports: node --test runs this file as it is (app/test/notify-target.test.ts).
import type { InboxItem } from '@shared/types'

export type NotifyTarget = { tab: 'board' | 'inbox'; sessionId: string | null; itemId: string | null }

const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/** The target of a hash route (also inside a full URL); null when it is none of the routes above. */
export function parseTarget(url: string | null | undefined): NotifyTarget | null {
  if (!url) return null
  const at = url.indexOf('#/')
  if (at < 0) return null
  const m = url.slice(at + 2).split('?')[0].match(/^(board|inbox)(?:\/(.*))?$/)
  if (!m) return null
  const tab = m[1] as NotifyTarget['tab']
  const rest = m[2] || ''
  if (tab === 'inbox' && rest.startsWith('item/')) {
    const itemId = decode(rest.slice(5))
    return { tab, sessionId: null, itemId: itemId || null }
  }
  return { tab, sessionId: rest ? decode(rest) : null, itemId: null }
}

const REQUESTS = new Set(['approval', 'clarify', 'permission'])

/** The route for an inbox entry, the same the backend puts into its pushes. */
export function targetUrl(item: Pick<InboxItem, 'id' | 'kind' | 'sessionId'>): string {
  if (item.sessionId) return `#/${REQUESTS.has(item.kind) ? 'inbox' : 'board'}/${encodeURIComponent(item.sessionId)}`
  return item.kind === 'automation' ? `#/inbox/item/${encodeURIComponent(item.id)}` : '#/inbox'
}
