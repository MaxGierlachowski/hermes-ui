// Background delivery without Firebase: Android freezes a backgrounded app within seconds, which stops
// the iroh connection and the live stream. While Hermes works on a chat (or always, if chosen), a
// foreground service with a quiet ongoing notification keeps the process running, so finished turns
// and new approvals still arrive as notifications. It ends 30 s after the last turn finished, which
// leaves time for the "done" entry that follows the turn.
import { AppState, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { KeepAlive } from 'expo-iroh'
import { getState, subscribe } from './store'
import { t } from './i18n'

export type KeepAliveMode = 'auto' | 'always' | 'off'
let mode: KeepAliveMode = 'auto'
let running = false
let stopTimer: ReturnType<typeof setTimeout> | undefined

const working = () => Object.values(getState().sessions).filter((s) => s.running).length

function text(n: number) {
  return n ? t('Hermes arbeitet an {n} Chat(s) – Antworten kommen als Benachrichtigung', { n }) : t('Verbunden – neue Inbox-Einträge kommen als Benachrichtigung')
}

function apply() {
  if (Platform.OS !== 'android') return
  // The system may have stopped it (dataSync time limit); start it again from the foreground.
  if (running && !KeepAlive.isRunning()) running = false
  const st = getState()
  const n = working()
  const want = st.auth === 'ok' && mode !== 'off' && (mode === 'always' || n > 0)
  if (want) {
    clearTimeout(stopTimer)
    stopTimer = undefined
    if (!running && AppState.currentState === 'active') running = KeepAlive.start('Hermes UI', text(n))
    else if (running) KeepAlive.update('Hermes UI', text(n))
  } else if (running && !stopTimer) {
    stopTimer = setTimeout(() => { stopTimer = undefined; if (!(mode === 'always' || working() > 0)) { KeepAlive.stop(); running = false } }, mode === 'off' ? 0 : 30_000)
  }
}

export async function setKeepAliveMode(m: KeepAliveMode) {
  mode = m
  await AsyncStorage.setItem('hk_keepalive', m)
  apply()
}
export const keepAliveMode = () => mode

export async function startKeepAlivePolicy() {
  const saved = await AsyncStorage.getItem('hk_keepalive')
  if (saved === 'auto' || saved === 'always' || saved === 'off') mode = saved
  subscribe(apply)
  AppState.addEventListener('change', apply)
  apply()
}
