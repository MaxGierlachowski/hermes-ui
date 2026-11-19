import '../global.css'
import { useEffect } from 'react'
import { LogBox, View } from 'react-native'
import { Stack, router, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as Notifications from 'expo-notifications'
import * as SystemUI from 'expo-system-ui'
import { useColorScheme } from 'nativewind'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent'
import { bootstrap, openThread, setTab, startDemo, useStore } from '@/lib/store'
import { setupNotifications } from '@/lib/notify'
import { startKeepAlivePolicy } from '@/lib/keepalive'
import { setSharedDraft } from '@/lib/share'
import { THEME } from '@/lib/theme'
import { Toast } from '@/components/Toast'

SplashScreen.preventAutoHideAsync()

// Store screenshots: a build with EXPO_PUBLIC_DEMO_TOUR=1 starts the demo by itself and shows board,
// a thread and the inbox, 8 s each (simulators cannot tap). Normal builds drop this code.
const DEMO_TOUR = process.env.EXPO_PUBLIC_DEMO_TOUR === '1'
async function demoTour() {
  await startDemo()
  router.replace('/')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  await wait(8000)
  openThread('demo-site'); router.push('/thread/demo-site')
  await wait(8000)
  router.back(); setTab('inbox')
}
// Dev builds only: library deprecation warnings would cover the composer and tab bar.
if (__DEV__) LogBox.ignoreAllLogs(true)

const navTheme = (dark: boolean) => {
  const c = THEME[dark ? 'dark' : 'light']
  const base = dark ? DarkTheme : DefaultTheme
  return { ...base, colors: { ...base.colors, background: c.background, card: c.background, text: c.foreground, border: c.border, primary: c.primary } }
}

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

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const auth = useStore((s) => s.auth)
  useEffect(() => {
    AsyncStorage.getItem('hk_theme').then((v) => { if (v === 'light' || v === 'dark') setColorScheme(v) })
    if (DEMO_TOUR) demoTour()
    else bootstrap()
    setupNotifications(false).catch(() => {})
    startKeepAlivePolicy()
  }, [])
  useEffect(() => { if (auth !== 'unknown') SplashScreen.hideAsync() }, [auth])
  // Window background behind the edge-to-edge system bars = the page background of the theme.
  useEffect(() => { SystemUI.setBackgroundColorAsync(THEME[dark ? 'dark' : 'light'].background).catch(() => {}) }, [dark])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ShareIntentProvider>
          <ThemeProvider value={navTheme(dark)}>
            <View className="flex-1 bg-background">
              <StatusBar style={dark ? 'light' : 'dark'} />
              {/* Android: ios_from_right runs 200 ms (config_shortAnimTime) where slide_from_right takes
                  400 ms; fade_from_bottom 210 ms instead of 400. iOS: 250 ms, swipe back from anywhere. */}
              <Stack screenOptions={{ headerShown: false, animation: 'ios_from_right', animationDuration: 250, gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: THEME[dark ? 'dark' : 'light'].background } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="pair" options={{ animation: 'fade' }} />
                <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
                <Stack.Screen name="new" options={{ presentation: 'modal', animation: 'fade_from_bottom' }} />
                <Stack.Screen name="thread/[id]" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="search" options={{ animation: 'fade' }} />
                <Stack.Screen name="paseo/[id]" />
                <Stack.Screen name="demo" options={{ animation: 'none' }} />
              </Stack>
              <Toast />
              <ShareIntentRouter />
              <NotificationRouter />
            </View>
          </ThemeProvider>
        </ShareIntentProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
