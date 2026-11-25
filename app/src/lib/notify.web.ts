// Web / desktop notifications. Same API as notify.ts:
//   - desktop app (macOS): UNUserNotificationCenter through the shell (`notification_permission`,
//     `notify`): the system asks once, a click opens the chat. Elsewhere Tauri's notification plugin,
//   - browser: the Notification API while the tab is open (Web Push like the shadcn UI is not wired
//     up here yet, see docs/decisions/0012-universal-app.md).
import type { InboxItem } from '@shared/types'
import { invoke, isDesktop } from './desktop.web'
import { targetUrl } from './notify-target'
import { openTarget } from './nav'

export const CHANNEL = 'hermes'

async function plugin() { return import('@tauri-apps/plugin-notification') }

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

/** The current decision; with `ask` the system dialog appears if the user has not decided yet. */
export async function notificationPermission(ask: boolean): Promise<NotificationPermission> {
  if (isDesktop) {
    const native = await invoke<NotificationPermission>('notification_permission', { request: ask })
    if (native && native !== 'unsupported') return native
    const n = await plugin()
    if (await n.isPermissionGranted()) return 'granted'
    return ask ? ((await n.requestPermission()) === 'granted' ? 'granted' : 'denied') : 'prompt'
  }
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default' || !ask) return Notification.permission === 'default' ? 'prompt' : Notification.permission
  const r = await Notification.requestPermission()
  return r === 'default' ? 'prompt' : r
}

export const setupNotifications = async (ask: boolean) => (await notificationPermission(ask)) === 'granted'

/** On the desktop a window that is open but not focused counts as "in the background". */
export const appInBackground = () => typeof document !== 'undefined' && (document.hidden || !document.hasFocus())

export async function notifyInboxItem(item: InboxItem, label: string, title: string) {
  const body = item.text ? (item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text) : ''
  try {
    if (isDesktop) {
      // The shell hands `sessionId` back on a click ("notification-click"): the route to open, not only a chat.
      if (await invoke<boolean>('notify', { title: `${label} · ${title}`, body, sessionId: targetUrl(item) })) return
      ;(await plugin()).sendNotification({ title: `${label} · ${title}`, body })
      return
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(`${label} · ${title}`, { body, tag: item.id })
      n.onclick = () => { window.focus(); n.close(); openTarget(targetUrl(item)) }
    }
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
