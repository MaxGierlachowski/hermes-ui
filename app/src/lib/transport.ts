// Native transport (iOS / Android): iroh through the expo-iroh module. The web build uses
// transport.web.ts instead (Metro picks the .web file for the web platform).
//
// Stored in the platform keystore (expo-secure-store → Android Keystore / iOS Keychain):
//   - the gateway (endpoint id + relay hint) this app is paired with,
//   - this device's iroh secret key, so its endpoint id (what the gateway allow-lists) never changes.
import * as SecureStore from 'expo-secure-store'
import { IrohBackend, IrohError } from 'expo-iroh'
import { Platform } from 'react-native'
import type { Backend } from './connection'

/** Where the backend is. Native apps only reach it over iroh. */
export type Target = { kind?: 'iroh'; endpointId: string; relayUrl?: string } | { kind: 'http'; baseUrl: string; token: string }

const GATEWAY_KEY = 'hermes-ui.gateway'
const SECRET_KEY = 'hermes-ui.iroh-secret-key'

export async function savedTarget(): Promise<Target | null> {
  try { return JSON.parse((await SecureStore.getItemAsync(GATEWAY_KEY)) || 'null') } catch { return null }
}
/** Native: nothing besides the saved pairing (the desktop shell provides a local backend). */
export const activeTarget = savedTarget

export async function rememberTarget(target: Target) {
  await SecureStore.setItemAsync(GATEWAY_KEY, JSON.stringify(target))
}
export async function forgetTarget() {
  await SecureStore.deleteItemAsync(GATEWAY_KEY)
}

/** Creates the endpoint (with the stored identity) and dials the gateway. */
export async function openTransport(target: Target, timeoutMs: number): Promise<Backend> {
  if (target.kind === 'http') throw new Error('HTTP backends are only supported on the desktop and web builds')
  const gateway = { endpointId: target.endpointId, relayUrl: target.relayUrl }
  const t0 = Date.now()
  const secretKey = await SecureStore.getItemAsync(SECRET_KEY)
  const b = await IrohBackend.connect(gateway, { secretKey, timeoutMs, lazy: true })
  const t1 = Date.now()
  if (b.secretKey !== secretKey) await SecureStore.setItemAsync(SECRET_KEY, b.secretKey)
  // Dial now, but don't fail here: requests redial, and the board shows "offline" meanwhile.
  try { await b.dial(timeoutMs) } catch { /* reported by the first request */ }
  // One log line per connect (logcat tag ReactNativeJS): endpoint setup, dial, and the path it took.
  const path = b.connectionInfo()
  console.log(`[hermes-ui] iroh endpoint ${t1 - t0} ms, dial ${Date.now() - t1} ms, path ${path?.kind ?? 'none'}${path?.paths.find((p) => p.selected) ? ` ${path.paths.find((p) => p.selected)!.rttMs.toFixed(1)} ms rtt` : ''}`)
  return b
}

export const closeTransport = () => IrohBackend.close()
export const isTransportError = (e: unknown) => e instanceof IrohError
export const deviceName = () => `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} · Hermes UI app`
export const libraryInfo = () => IrohBackend.libraryInfo()

/** Desktop only (transport.web.ts); native apps have no built-in backend. */
export async function startBuiltInBackend(): Promise<Target> { throw new Error('not available') }
