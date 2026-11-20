import { useEffect } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { requestRecordingPermissionsAsync } from 'expo-audio'
import { setTab, startDemo, toast, useStore } from '@/lib/store'
import { showThread } from '@/lib/nav'

/**
 * <scheme>://demo starts the demo mode without the pairing screen (for reviewers and screenshots).
 * Optional: ?tab=inbox, ?thread=<demo chat id>, ?long=<n> (adds a chat with n messages, id demo-long), ?board=<n> (n chats in Done),
 * ?selftest=microphone|camera (asks for the device at once; checks a build's permission setup). Ignored while the app is paired with a backend.
 */
async function selfTest(kind: 'microphone' | 'camera') {
  const granted = kind === 'microphone'
    ? (await requestRecordingPermissionsAsync()).granted
    : await globalThis.navigator?.mediaDevices?.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((tr) => tr.stop()); return true }, () => false) ?? false
  toast(`${kind}: ${granted ? 'granted' : 'refused'}`, granted ? 'success' : 'error')
}

export default function DemoRoute() {
  const { tab, thread, long, board, selftest } = useLocalSearchParams<{ tab?: string; thread?: string; long?: string; board?: string; selftest?: string }>()
  const auth = useStore((s) => s.auth)
  const demo = useStore((s) => s.demo)
  useEffect(() => {
    if (auth === 'unknown') return
    ;(async () => {
      if (!demo && auth !== 'ok') await startDemo({ longThread: Number(long) || undefined, board: Number(board) || undefined })
      setTab(tab === 'inbox' ? 'inbox' : 'board')
      router.replace('/')
      if (thread) showThread(thread)
      // Permission check of a build: ask for the device at once, so the system dialog shows without
      // clicking (desktop-app: HERMES_UI_DESKTOP_ROUTE='/demo?selftest=microphone').
      if (selftest === 'microphone' || selftest === 'camera') selfTest(selftest)
    })()
  }, [auth === 'unknown'])
  return <View className="flex-1 bg-background" />
}
