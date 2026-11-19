// Web / desktop notifications. Same API as notify.ts:
//   - desktop app: the system notification centre through Tauri's notification plugin,
//   - browser: the Notification API while the tab is open (Web Push like the shadcn UI is not wired
//     up here yet, see docs/decisions/0012-universal-app.md).
import type { InboxItem } from '@shared/types'
import { isDesktop } from './desktop.web'

export const CHANNEL = 'hermes'

async function plugin() { return import('@tauri-apps/plugin-notification') }

export async function setupNotifications(ask: boolean) {
  if (isDesktop) {
    const n = await plugin()
    if (await n.isPermissionGranted()) return true
    return ask ? (await n.requestPermission()) === 'granted' : false
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted' || !ask) return Notification.permission === 'granted'
  return (await Notification.requestPermission()) === 'granted'
}

/** On the desktop a window that is open but not focused counts as "in the background". */
export const appInBackground = () => typeof document !== 'undefined' && (document.hidden || !document.hasFocus())

export async function notifyInboxItem(item: InboxItem, label: string, title: string) {
  const body = item.text ? (item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text) : ''
  try {
    if (isDesktop) { (await plugin()).sendNotification({ title: `${label} · ${title}`, body }); return }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`${label} · ${title}`, { body, tag: item.id })
  } catch { /* no permission */ }
}

export async function testNotification() {
  if (!(await setupNotifications(true))) return
  setTimeout(() => notifyInboxItem({ id: 'test', kind: 'done', source: 'hermes', sessionId: null, title: null, text: 'Lokale Benachrichtigung funktioniert.', at: 0, read: true } as InboxItem, 'Hermes UI', 'Test'), 2000)
}

/** Remote push (FCM / APNs) is for the phone apps; on the desktop the app itself stays in the tray. */
export async function registerRemotePush(): Promise<'on' | 'unavailable' | 'denied' | 'backend-missing'> {
  return (await setupNotifications(true)) ? 'unavailable' : 'denied'
}
