import { useEffect } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { setTab, startDemo, useStore } from '@/lib/store'
import { showThread } from '@/lib/nav'

/**
 * <scheme>://demo starts the demo mode without the pairing screen (for reviewers and screenshots).
 * Optional: ?tab=inbox, ?thread=<demo chat id>. Ignored while the app is paired with a backend.
 */
export default function DemoRoute() {
  const { tab, thread } = useLocalSearchParams<{ tab?: string; thread?: string }>()
  const auth = useStore((s) => s.auth)
  const demo = useStore((s) => s.demo)
  useEffect(() => {
    if (auth === 'unknown') return
    ;(async () => {
      if (!demo && auth !== 'ok') await startDemo()
      setTab(tab === 'inbox' ? 'inbox' : 'board')
      router.replace('/')
      if (thread) showThread(thread)
    })()
  }, [auth === 'unknown'])
  return <View className="flex-1 bg-background" />
}
