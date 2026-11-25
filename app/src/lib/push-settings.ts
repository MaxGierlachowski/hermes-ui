// The automation switches under Settings → Benachrichtigungen. They decide which new automation
// entries (cron runs, webhook runs, `POST /api/notify`) become a system notification on this device
// (notify.ts) and, once remote push (FCM) is on, are the backend's settings for this device's token
// (POST /api/push/settings). Kept on the device; the defaults are the backend's (server/src/push.mjs).
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { InboxItem, PushSettings } from '@shared/types'
import { api } from './connection'

export type AutomationPush = Pick<PushSettings, 'automations' | 'automationErrors' | 'notify'>
export const DEFAULT_AUTOMATION_PUSH: AutomationPush = { automations: true, automationErrors: true, notify: true }

const KEY = 'hk_push'
const ENDPOINT_KEY = 'hk_push_endpoint'
let current: AutomationPush = { ...DEFAULT_AUTOMATION_PUSH }
let endpoint: string | null = null

const ready = Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(ENDPOINT_KEY)]).then(([s, e]) => {
  try { if (s) current = { ...DEFAULT_AUTOMATION_PUSH, ...JSON.parse(s) } } catch { /* broken value: defaults */ }
  endpoint = e
}).catch(() => {})

export async function loadAutomationPush() { await ready; return current }
export const automationPush = () => current

/** Saves a switch; with remote push on, the backend gets it too (best effort, the device keeps it either way). */
export async function saveAutomationPush(patch: Partial<AutomationPush>) {
  await ready
  current = { ...current, ...patch }
  await AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {})
  if (endpoint) await api('/api/push/settings', { method: 'POST', json: { endpoint, settings: patch } }).catch(() => {})
  return current
}

/** The FCM subscription the backend created (POST /api/push/native); later switch changes go to it. */
export function rememberPushEndpoint(e: string | null | undefined) {
  endpoint = e || null
  ;(endpoint ? AsyncStorage.setItem(ENDPOINT_KEY, endpoint) : AsyncStorage.removeItem(ENDPOINT_KEY)).catch(() => {})
}

/** The switch an entry falls under (the backend's rule in notifyAutomation()); null = chats and agents. */
export function pushCategory(item: Pick<InboxItem, 'kind' | 'source' | 'status'>): keyof AutomationPush | null {
  if (item.kind !== 'automation') return null
  if (item.status === 'error') return 'automationErrors'
  return item.source === 'notify' ? 'notify' : 'automations'
}
export const wantsNotification = (item: Pick<InboxItem, 'kind' | 'source' | 'status'>) => {
  const c = pushCategory(item)
  return !c || current[c] !== false
}
