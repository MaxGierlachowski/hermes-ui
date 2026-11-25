// Notifications. Two paths:
//   1. Local: while the app runs (foreground or recently backgrounded) every new inbox entry from the
//      live stream becomes a system notification. Works without any account.
//   2. Remote (FCM on Android, APNs on iOS): the device token is registered with the backend
//      (POST /api/push/native), which then pushes like it does for Web Push. Needs the app built with
//      a google-services.json (see README) — without it getDevicePushTokenAsync fails and we stay local.
import * as Notifications from 'expo-notifications'
import { AppState, Platform } from 'react-native'
import type { InboxItem } from '@shared/types'
import { api } from './connection'
import { targetUrl } from './notify-target'
import { loadAutomationPush, rememberPushEndpoint } from './push-settings'

export const CHANNEL = 'hermes'

Notifications.setNotificationHandler({
  // In the foreground the app shows its own toast; only background/remote ones reach the tray.
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
})

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'
export async function notificationPermission(ask: boolean): Promise<NotificationPermission> {
  if (ask) await setupNotifications(true)
  const p = await Notifications.getPermissionsAsync()
  return p.granted ? 'granted' : p.canAskAgain ? 'prompt' : 'denied'
}

export async function setupNotifications(ask: boolean) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Hermes',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120, 80, 120],
      lightColor: '#615fff',
    })
  }
  const current = await Notifications.getPermissionsAsync()
  if (current.granted || !ask) return current.granted
  return (await Notifications.requestPermissionsAsync()).granted
}

/** Not in the foreground: new inbox entries become system notifications instead of toasts. */
export const appInBackground = () => AppState.currentState !== 'active'

export async function notifyInboxItem(item: InboxItem, label: string, title: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${label} · ${title}`,
        body: item.text ? (item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text) : '',
        // url: the route a tap opens (components/PlatformShell.tsx), the same the backend's pushes carry.
        data: { url: targetUrl(item), sessionId: item.sessionId },
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
      },
      trigger: null,
    })
  } catch { /* no permission */ }
}

/** Test notification from Settings (local path). */
export const testNotification = () => Notifications.scheduleNotificationAsync({
  content: { title: 'Hermes UI', body: 'Lokale Benachrichtigung funktioniert.', data: {}, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
  trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2 },
})

/** Remote push: registers the FCM/APNs token with the backend. Resolves to the state for Settings. */
export async function registerRemotePush(): Promise<'on' | 'unavailable' | 'denied' | 'backend-missing'> {
  if (!(await setupNotifications(true))) return 'denied'
  let token: Notifications.DevicePushToken
  try { token = await Notifications.getDevicePushTokenAsync() } catch { return 'unavailable' }
  try {
    const r = await api<{ endpoint?: string }>('/api/push/native', { method: 'POST', json: { token: token.data, kind: token.type === 'ios' ? 'apns' : 'fcm', platform: Platform.OS, settings: await loadAutomationPush() } })
    rememberPushEndpoint(r?.endpoint)
    return 'on'
  } catch { return 'backend-missing' }
}
