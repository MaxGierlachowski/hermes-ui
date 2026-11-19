// Native-only wrappers around the app: "Share → Hermes UI" and taps on notifications. The web and
// desktop build uses PlatformShell.web.tsx (keyboard shortcuts, native menu, dock badge).
import { useEffect, type ReactNode } from 'react'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent'
import { openThread, setTab, useStore } from '@/lib/store'
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

/** A tap on a notification opens its thread (or the inbox for approvals). */
function NotificationRouter() {
  const last = Notifications.useLastNotificationResponse()
  useEffect(() => {
    const data = last?.notification.request.content.data as { sessionId?: string | null; inbox?: boolean } | undefined
    if (!data) return
    if (data.inbox) setTab('inbox')
    if (data.sessionId) { openThread(data.sessionId); router.push(`/thread/${encodeURIComponent(data.sessionId)}`) }
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
