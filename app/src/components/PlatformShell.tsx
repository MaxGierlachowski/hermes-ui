// Native-only wrappers around the app: "Share → Hermes UI" and taps on notifications. The web and
// desktop build uses PlatformShell.web.tsx (keyboard shortcuts, native menu, dock badge).
import { useEffect, type ReactNode } from 'react'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent'
import { setTab, useStore } from '@/lib/store'
import { openTarget, showThread } from '@/lib/nav'
import { setSharedDraft } from '@/lib/share'

/** "Share → Hermes UI": text or an image becomes the draft of a new chat. */
function ShareIntentRouter() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext()
  const auth = useStore((s) => s.auth)
  useEffect(() => {
    if (!hasShareIntent || auth !== 'ok') return
    const image = shareIntent.files?.find((f) => f.mimeType?.startsWith('image/'))
    const text = shareIntent.text || ''
    setSharedDraft({ text: (shareIntent.webUrl && !text.includes(shareIntent.webUrl) ? `${text}\n${shareIntent.webUrl}` : text).trim(), imageUri: image ? (image.path.startsWith('file:') || image.path.startsWith('content:') ? image.path : `file://${image.path}`) : null, mimeType: image?.mimeType })
    resetShareIntent()
    router.push('/new')
  }, [hasShareIntent, auth])
  return null
}

/**
 * A tap on a notification opens what it is about. Remote pushes (FCM) carry the backend's route in
 * `url` (`#/board/<chat>`, `#/inbox/<chat>`, `#/inbox/item/<entry>`, see lib/notify-target.ts); the
 * app's local notifications carry the same route, older ones only `sessionId` / `inbox`.
 */
function NotificationRouter() {
  const last = Notifications.useLastNotificationResponse()
  useEffect(() => {
    const data = last?.notification.request.content.data as { url?: string; sessionId?: string | null; inbox?: boolean } | undefined
    if (!data) return
    if (typeof data.url === 'string' && openTarget(data.url)) return
    if (data.inbox) setTab('inbox')
    if (data.sessionId) showThread(data.sessionId)
  }, [last])
  return null
}

export function PlatformShell({ children }: { children: ReactNode }) {
  return (
    <ShareIntentProvider>
      {children}
      <ShareIntentRouter />
      <NotificationRouter />
    </ShareIntentProvider>
  )
}
