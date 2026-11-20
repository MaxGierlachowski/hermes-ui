// App state: one small external store fed by the REST API + the /api/events SSE stream, both over
// iroh. Mirrors web/src/lib/store.ts (same endpoints, same events), without DOM APIs.
import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Column, InboxItem, OpenItem, OutgoingMessage, PaseoAgent, PaseoItem, Session, ThreadMessage } from '@shared/types'
import { parsePairingLink } from '@shared/pairing'
import { activeTarget, api, ApiError, clearMedia, connect, deviceName, forgetGateway, getBackend, isNetworkError, pruneMedia, rememberGateway, setDemoBackend, Unauthorized, type Target } from './connection'
import { DemoBackend } from './demo'
import { clearCache, initCache, readCache, trimMessages, writeCache } from './cache'
import { appInBackground, notifyInboxItem } from './notify'
import { t } from './i18n'
import { agentTimelinePath } from './agents'

export type Auth = 'unknown' | 'unpaired' | 'connecting' | 'ok' | 'refused' | 'offline'
export type Tab = 'board' | 'inbox'

type State = {
  auth: Auth
  error: string | null
  sessions: Record<string, Session>
  gateway: boolean
  live: boolean
  /** Optional time window in days, 0 = none: the newest chats, older ones page in while scrolling. */
  days: number
  system: boolean
  /** Where the next older page starts; null = everything is loaded. */
  nextCursor: string | null
  loadingMore: boolean
  tab: Tab
  column: Column
  openId: string | null
  messages: ThreadMessage[]
  loadingThread: boolean
  streaming: { id: string; text: string } | null
  pendingFirst: { id: string; text: string; ts: number } | null
  inbox: { open: OpenItem[]; items: InboxItem[]; unread: number; loaded: boolean; paseo: { connected: boolean; canRespond: boolean } }
  /** In-app notices, newest last (components/Toast.tsx shows up to three as a stack). */
  toasts: ToastItem[]
  // Stale-while-revalidate: background loads in flight (header progress bar), when the board data
  // shown was loaded (the offline hint says "as of …"), and whether it came from the cache.
  syncing: number
  boardAt: number | null
  hydrated: boolean
  /** Demo mode: sample data from demo.ts instead of a backend. */
  demo: boolean
}

let state: State = {
  auth: 'unknown',
  error: null,
  sessions: {},
  gateway: false,
  live: false,
  days: 0,
  system: false,
  nextCursor: null,
  loadingMore: false,
  tab: 'board',
  column: 'doing',
  openId: null,
  messages: [],
  loadingThread: false,
  streaming: null,
  pendingFirst: null,
  inbox: { open: [], items: [], unread: 0, loaded: false, paseo: { connected: false, canRespond: false } },
  toasts: [],
  syncing: 0,
  boardAt: null,
  hydrated: false,
  demo: false,
}
const listeners = new Set<() => void>()
const set = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((l) => l())
}
export const getState = () => state
/** Plain subscription outside React (keep-alive policy). */
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => select(state))
}

export type ToastItem = { id: number; kind: 'info' | 'error' | 'success'; text: string; description?: string; sessionId?: string | null }
let toastId = 0
/** A notice: `text` is the title, `description` an optional second line; a click opens `sessionId`. */
export function toast(text: string, kind: 'info' | 'error' | 'success' = 'info', sessionId?: string | null, description?: string) {
  set((s) => ({ toasts: [...s.toasts, { id: ++toastId, kind, text, description, sessionId }].slice(-5) }))
}
export const dismissToast = (id?: number) => set((s) => ({ toasts: id == null ? [] : s.toasts.filter((x) => x.id !== id) }))

const handle = (err: unknown, quiet = false) => {
  if (err instanceof Unauthorized) { set({ auth: 'refused' }); return }
  // A background refresh that cannot reach the backend keeps what is on screen; the header says offline.
  if (quiet && isNetworkError(err)) return
  toast(err instanceof Error ? err.message : String(err), 'error')
}

/** Counts a background load for the header's progress bar. */
async function track<T>(p: Promise<T>): Promise<T> {
  set((s) => ({ syncing: s.syncing + 1 }))
  try { return await p } finally { set((s) => ({ syncing: s.syncing - 1 })) }
}

// ---------- cache ----------
type BoardCache = { sessions: Session[]; gateway: boolean }
type InboxCache = Omit<State['inbox'], 'loaded'>

/** Startup: the last board and inbox from the cache, before the connection is even up. */
function hydrate() {
  const board = readCache<BoardCache>('board')
  const inbox = readCache<InboxCache>('inbox')
  if (inbox) set({ inbox: { ...inbox.data, loaded: true } })
  if (!board) return
  set({ sessions: Object.fromEntries(board.data.sessions.map((s) => [s.id, s])), gateway: false, boardAt: board.at, hydrated: true })
  pickColumn(board.data.sessions)
}
const persistBoard = () => writeCache<BoardCache>('board', { sessions: Object.values(state.sessions), gateway: state.gateway }, 1000)
const persistInbox = () => { const { loaded: _, ...rest } = state.inbox; writeCache<InboxCache>('inbox', rest, 1000) }
const threadKey = (id: string) => `thread:${id}`
const persistThread = (id: string, messages: ThreadMessage[]) => writeCache(threadKey(id), trimMessages(messages.filter((m) => !m.live)))

// ---------- startup and pairing ----------
let prefsLoaded = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
// Startup marks (DevTools → Performance, scripts/measure-ui.mjs): where the cold start goes.
const mark = (name: string) => { try { globalThis.performance?.mark?.(`hk:${name}`) } catch { /* not supported */ } }

export async function bootstrap() {
  mark('bootstrap')
  clearTimeout(retryTimer)
  if (!prefsLoaded) {
    // `window` replaced `days` (0.5.1): the old default of 3 days must not stick as a filter.
    const { window, system, column } = JSON.parse((await AsyncStorage.getItem('hk_prefs')) || '{}') as { window?: number; system?: boolean; column?: Column }
    const prefs = { ...(window != null && { days: window }), ...(system != null && { system }), ...(column && { column }) }
    set(prefs)
    columnChosen = !!prefs.column
    prefsLoaded = true
  }
  if (state.demo) return
  mark('prefs')
  await initCache()
  mark('cache')
  const gw = await activeTarget()
  mark('target')
  // Not paired: nothing cached is worth keeping (e.g. what a demo left behind).
  if (!gw) { clearCache(); set({ auth: 'unpaired' }); return }
  if (!state.hydrated) hydrate()
  set({ auth: 'connecting', error: null })
  try {
    await track((async () => { await connect(gw); await start() })())
  } catch (err) {
    const refused = err instanceof Unauthorized
    set({ auth: refused ? 'refused' : 'offline', error: err instanceof Error ? err.message : String(err) })
    // Offline with the cached board on screen: keep trying quietly.
    if (!refused) retryTimer = setTimeout(() => { if (state.auth === 'offline') bootstrap() }, 15_000)
  }
}

/** Pairs with a link (#iroh=…&relay=…&pair=…): connects, redeems the one-time code, remembers the gateway. */
export async function pair(link: string) {
  const p = parsePairingLink(link)
  if (!p) throw new Error(t('Das ist kein Kopplungslink (#iroh=…).'))
  if (state.demo) await exitDemo()
  set({ auth: 'connecting', error: null })
  const gateway: Target = { endpointId: p.endpointId, relayUrl: p.relayUrl }
  try {
    await connect(gateway)
    if (p.code) await api('/api/pair/redeem', { method: 'POST', json: { code: p.code, name: deviceName() }, timeoutMs: 30_000 })
    await rememberGateway(gateway)
    await start()
    toast(t('Gerät gekoppelt'), 'success')
  } catch (err) {
    set({ auth: 'unpaired', error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Desktop / web: a backend on this machine, reached over plain HTTP with its token (no iroh). */
export async function connectLocal(baseUrl: string, token: string) {
  if (state.demo) await exitDemo()
  set({ auth: 'connecting', error: null })
  const target: Target = { kind: 'http', baseUrl: baseUrl.replace(/\/$/, ''), token }
  try {
    await connect(target)
    await rememberGateway(target)
    await start()
  } catch (err) {
    set({ auth: 'unpaired', error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Demo mode: the app with sample data and no backend, e.g. for a first look or an app review. */
export async function startDemo(opts: { longThread?: number } = {}) {
  clearTimeout(retryTimer)
  stopEvents()
  clearCache()
  setDemoBackend(new DemoBackend(opts))
  set({ demo: true, auth: 'connecting', error: null, sessions: {}, openId: null, messages: [], hydrated: false, boardAt: null })
  await start()
}

export async function exitDemo() {
  stopEvents()
  setDemoBackend(null)
  clearCache()
  clearMedia()
  set({ demo: false, auth: 'unpaired', sessions: {}, openId: null, messages: [], streaming: null, hydrated: false, boardAt: null, inbox: { ...state.inbox, open: [], items: [], unread: 0, loaded: false } })
}

export async function unpair() {
  if (state.demo) return exitDemo()
  stopEvents()
  await forgetGateway()
  clearCache()
  clearMedia()
  set({ auth: 'unpaired', sessions: {}, openId: null, messages: [], hydrated: false, boardAt: null, inbox: { ...state.inbox, open: [], items: [], unread: 0, loaded: false } })
}

async function start() {
  const t0 = Date.now()
  await loadSessions(true)
  mark('sessions')
  console.log(`[hermes-ui] board loaded in ${Date.now() - t0} ms (${Object.keys(state.sessions).length} sessions)`)
  set({ auth: 'ok' })
  connectEvents()
  loadInbox()
  setTimeout(pruneMedia, 5000)
}

// ---------- loading ----------
// The board loads in pages (newest activity first). A reload fetches the first page again; once older
// pages were scrolled in, it merges by id and keeps everything loaded (and the cursor), so live
// refreshes never drop them and no row between the pages goes missing. A filter change starts over.
type Page = { sessions: Session[]; nextCursor?: string | null; gateway: boolean }
const PAGE = 50
const sessionsUrl = (before?: string) => `/api/sessions?limit=${PAGE}&system=${state.system ? 1 : 0}${state.days ? `&days=${state.days}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`
let paged = false // a later page was loaded since the last reset
let generation = 0 // bumped by a filter change: answers to older requests are dropped

export async function loadSessions(throwing = false, reset = false) {
  const gen = reset ? ++generation : generation
  if (reset) paged = false
  try {
    const page = await track(api<Page>(sessionsUrl()))
    if (gen !== generation) return true
    const first = Object.fromEntries(page.sessions.map((s) => [s.id, s]))
    set((st) => paged
      ? { gateway: page.gateway, sessions: { ...st.sessions, ...first }, boardAt: Date.now() }
      : { gateway: page.gateway, sessions: first, nextCursor: page.nextCursor ?? null, boardAt: Date.now() })
    persistBoard()
    pickColumn(page.sessions)
    return true
  } catch (err) {
    if (throwing) throw err
    handle(err, true)
    return false
  }
}

/** Next older page (infinite scroll at the end of a column). */
export async function loadMore() {
  const cursor = state.nextCursor
  if (!cursor || state.loadingMore || state.demo) return
  const gen = generation
  set({ loadingMore: true })
  try {
    const page = await track(api<Page>(sessionsUrl(cursor)))
    if (gen !== generation) return
    paged = true
    set((st) => ({ sessions: { ...Object.fromEntries(page.sessions.map((s) => [s.id, s])), ...st.sessions }, nextCursor: page.nextCursor ?? null }))
    persistBoard()
  } catch (err) { handle(err, true) } finally { if (gen === generation) set({ loadingMore: false }) }
}

// Until the user picked a column: Waiting when something there needs an answer (like the web UI),
// otherwise the first one with cards (Doing, Waiting, New, Done).
function pickColumn(sessions: Session[]) {
  if (columnChosen) return
  const attention = sessions.some((s) => s.column === 'waiting' && s.pending?.length)
  const first = attention ? 'waiting' : (['doing', 'waiting', 'new', 'done'] as Column[]).find((c) => sessions.some((s) => s.column === c))
  if (first) set({ column: first })
}

let columnChosen = false
export async function setPrefs(patch: Partial<Pick<State, 'days' | 'system' | 'column'>>) {
  if (patch.column) columnChosen = true
  set(patch)
  await AsyncStorage.setItem('hk_prefs', JSON.stringify({ window: state.days, system: state.system, column: state.column }))
  if ('days' in patch || 'system' in patch) { set({ sessions: {}, nextCursor: null, loadingMore: false }); loadSessions(false, true) }
}
export const setTab = (tab: Tab) => { set({ tab }); if (tab === 'inbox') loadInbox() }

function upsert(s: Session) { set((st) => ({ sessions: { ...st.sessions, [s.id]: s } })); persistBoard() }
function remove(id: string) {
  set((st) => {
    const sessions = { ...st.sessions }
    delete sessions[id]
    return { sessions }
  })
  persistBoard()
}

// ---------- thread ----------
function withPending(id: string, messages: ThreadMessage[]) {
  const p = state.pendingFirst
  if (!p || p.id !== id) return messages
  if (messages.some((m) => m.role === 'user')) { set({ pendingFirst: null }); return messages }
  return [{ role: 'user' as const, text: p.text, ts: p.ts }, ...messages]
}

/** Opens a thread with what the cache has (rendered in the first frame), then refreshes it. */
export async function openThread(id: string | null) {
  if (id && id === state.openId) { refreshThread(id); return }
  const cached = id ? readCache<ThreadMessage[]>(threadKey(id))?.data : undefined
  set({ openId: id, messages: id && cached ? withPending(id, cached) : [], loadingThread: !!id && !cached, streaming: state.streaming?.id === id ? state.streaming : null })
  if (id) await refreshThread(id)
}

export async function refreshThread(id: string) {
  try {
    const { session, messages } = await track(api<{ session: Session; messages: ThreadMessage[] }>(`/api/sessions/${encodeURIComponent(id)}`))
    upsert(session)
    persistThread(id, messages)
    if (state.openId !== id) return
    set({ messages: withPending(id, messages), loadingThread: false })
  } catch (err) { set({ loadingThread: false }); handle(err, true) }
}

/** Long-press / warm-up: loads a thread into the cache without opening it. */
export function prefetchThread(id: string) {
  if (!readCache(threadKey(id))) refreshThread(id)
}

// Automated E2E runs mark their chats as "TEST · …" (web: localStorage hk_e2e_test). Dev builds only:
// start Metro with EXPO_PUBLIC_E2E_TEST=1.
const e2eTest = __DEV__ && process.env.EXPO_PUBLIC_E2E_TEST === '1'

export async function createChat(msg: OutgoingMessage) {
  const { session } = await api<{ session: Session }>('/api/sessions', { method: 'POST', json: e2eTest ? { ...msg, test: true } : msg, timeoutMs: 120_000 })
  upsert(session)
  if (!msg.draft) set({ pendingFirst: { id: session.id, text: msg.text || (msg.audio ? '🎙 Sprachnachricht …' : ''), ts: Date.now() / 1000 } })
  return session
}

export async function sendMessage(id: string, msg: OutgoingMessage) {
  let res: { session: Session; messages?: ThreadMessage[]; voice?: { transcribed: boolean; error?: string } }
  try {
    // A voice message is transcribed before it is sent: give Hermes' speech-to-text time.
    res = await api(`/api/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', json: msg, timeoutMs: msg.audio ? 300_000 : 120_000 })
  } catch (err) {
    if (err instanceof Unauthorized) { handle(err); return null }
    toast(`${t('Nachricht nicht zugestellt')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    refreshThread(id)
    return null
  }
  if (res.voice && !res.voice.transcribed) toast(`${t('Sprachnachricht nicht transkribiert – als Audiodatei gesendet')}${res.voice.error ? `: ${res.voice.error}` : ''}`, 'error')
  if (res.session && res.session.id !== id) { remove(id); upsert(res.session); return res.session.id }
  if (res.session) upsert(res.session)
  if (res.messages) persistThread(id, res.messages)
  if (res.messages && state.openId === id) set({ messages: res.messages })
  return id
}

export async function respond(id: string, body: { promptId: string; choice?: string; answer?: string; answers?: string[] }) {
  try {
    const res = await api<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}/respond`, { method: 'POST', json: body })
    if (res.session) upsert(res.session)
    loadInbox()
    return true
  } catch (err) { handle(err); refreshThread(id); return false }
}

export async function interrupt(id: string) {
  try { await api(`/api/sessions/${encodeURIComponent(id)}/interrupt`, { method: 'POST' }); toast(t('Stopp gesendet')) } catch (err) { handle(err) }
}

export async function setColumn(id: string, column: Column | 'auto') {
  try {
    const res = await api<{ session: Session | null; removed?: string; replaced?: string }>(`/api/sessions/${encodeURIComponent(id)}/column`, { method: 'POST', json: { column } })
    if (res.removed || res.replaced) remove((res.removed || res.replaced)!)
    if (res.session) upsert(res.session)
  } catch (err) { handle(err); loadSessions() }
}

export async function retryOutbox(sessionId: string, outboxId: string, retry = true) {
  try {
    const res = await api<{ session: Session; messages: ThreadMessage[] }>(`/api/outbox/${outboxId}${retry ? '/retry' : ''}`, { method: retry ? 'POST' : 'DELETE' })
    if (res.session) upsert(res.session)
    persistThread(sessionId, res.messages)
    if (state.openId === sessionId) set({ messages: res.messages })
  } catch (err) { handle(err); refreshThread(sessionId) }
}

export type SearchHit = { session: Session & { archived?: boolean }; hit?: { msgId: number; role: string; ts: number; snippet: string; hits: number } }
export const searchChats = (q: string) => api<{ q: string; title: SearchHit[]; content: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`)

// Paseo: agents per chat and their transcripts, cached like threads (screen state, not the store).
export const cachedPaseoAgents = (sessionId: string) => readCache<PaseoAgent[]>(`paseo:agents ${sessionId}`)?.data ?? null
export const cachedPaseoTimeline = (agentId: string) => readCache<PaseoItem[]>(`paseo:timeline ${agentId}`)?.data ?? null
export async function paseoAgents(sessionId: string) {
  const r = await track(api<{ agents: PaseoAgent[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/paseo`))
  writeCache(`paseo:agents ${sessionId}`, r.agents)
  return r
}
/** quiet: the 3-second poll of a running agent does not light up the progress bar each time. */
export async function paseoTimeline(agentId: string, quiet = false) {
  const req = api<{ items: PaseoItem[]; agent?: PaseoAgent }>(agentTimelinePath(agentId))
  const r = await (quiet ? req : track(req))
  writeCache(`paseo:timeline ${agentId}`, trimMessages(r.items))
  return r
}

// ---------- inbox ----------
export async function loadInbox() {
  try {
    const r = await track(api<{ open: OpenItem[]; items: InboxItem[]; unread: number; paseo: { connected: boolean; canRespond: boolean } }>('/api/inbox'))
    set({ inbox: { ...r, loaded: true } })
    persistInbox()
  } catch (err) { handle(err, true) }
}
export async function markRead(ids: string[] | 'all') {
  if (ids !== 'all' && !ids.length) return
  set((st) => ({ inbox: { ...st.inbox, items: st.inbox.items.map((x) => (ids === 'all' || ids.includes(x.id) ? { ...x, read: true } : x)) } }))
  try {
    const r = await api<{ unread: number }>('/api/inbox/read', { method: 'POST', json: { ids } })
    set((st) => ({ inbox: { ...st.inbox, unread: r.unread } }))
  } catch (err) { handle(err) }
}
export async function respondPaseo(agentId: string, requestId: string, decision: 'allow' | 'deny', message?: string) {
  try {
    await api(`/api/paseo/agents/${agentId}/permissions/${encodeURIComponent(requestId)}`, { method: 'POST', json: { decision, ...(message ? { message } : {}) } })
    toast(decision === 'allow' ? t('Paseo-Freigabe erteilt') : t('Paseo-Freigabe abgelehnt'), 'success')
    loadInbox()
    return true
  } catch (err) { handle(err); loadInbox(); return false }
}
export const badgeCount = (st = state) => st.inbox.open.length + st.inbox.unread

const KIND_LABEL: Record<string, string> = {
  approval: 'Freigabe nötig', clarify: 'Rückfrage von Hermes', permission: 'Paseo-Agent braucht eine Freigabe',
  done: 'Fertig', error: 'Fehler', 'paseo-done': 'Paseo-Agent fertig', 'paseo-error': 'Paseo-Agent mit Fehler', 'paseo-limit': 'Paseo-Agent hat ein Limit erreicht',
}
export const kindLabel = (k: string) => t(KIND_LABEL[k] || k)

// ---------- live events ----------
let stopStream: (() => void) | null = null
let reloadTimer: ReturnType<typeof setTimeout> | undefined

function stopEvents() { stopStream?.(); stopStream = null; set({ live: false }) }

export function connectEvents() {
  stopEvents()
  const b = getBackend()
  if (!b) return
  let opened = false
  stopStream = b.events('/api/events', (name, data) => {
    let d: any
    try { d = JSON.parse(data) } catch { return }
    switch (name) {
      case 'session':
        if ((d as Session).system && !state.system && !state.sessions[d.id]) return
        upsert(d)
        break
      case 'removed': remove(d.id); break
      case 'gateway': set({ gateway: d.connected }); break
      case 'inbox': set((st) => ({ inbox: { ...st.inbox, open: d.open, unread: d.unread } })); persistInbox(); break
      case 'inbox-item': {
        const item = d as InboxItem
        const known = state.inbox.items.some((x) => x.id === item.id)
        set((st) => ({ inbox: { ...st.inbox, items: known ? st.inbox.items.map((x) => (x.id === item.id ? item : x)) : [item, ...st.inbox.items] } }))
        if (!known) onNewInboxItem(item)
        persistInbox()
        break
      }
      case 'inbox-read': {
        const ids = d.ids as string[] | 'all'
        set((st) => ({ inbox: { ...st.inbox, items: st.inbox.items.map((x) => (ids === 'all' || ids.includes(x.id) ? { ...x, read: true } : x)) } }))
        persistInbox()
        break
      }
      case 'delta':
        set((st) => ({ streaming: { id: d.id, text: (st.streaming && st.streaming.id === d.id ? st.streaming.text : '') + d.text } }))
        break
      case 'message': {
        // Not open: keep a cached copy of that chat current, so opening it shows the new message at once.
        if (d.id !== state.openId) {
          const cached = readCache<ThreadMessage[]>(threadKey(d.id))
          if (cached) persistThread(d.id, [...cached.data, d.message])
          return
        }
        set((st) => ({ messages: [...st.messages, d.message] }))
        persistThread(d.id, state.messages)
        break
      }
      case 'reload':
        if (d.final && state.streaming?.id === d.id) set({ streaming: null })
        if (d.id !== state.openId) return
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => refreshThread(d.id), 250)
        break
    }
  }, (open) => {
    set({ live: open })
    // After a reconnect: catch up on what the stream missed.
    if (open && opened) { loadSessions(); loadInbox(); if (state.openId) refreshThread(state.openId) }
    if (open) opened = true
  })
}

/** In the foreground: an in-app toast; in the background: a local system notification. */
function onNewInboxItem(item: InboxItem) {
  const title = item.source === 'paseo' && item.agentTitle ? item.agentTitle : item.title || 'Hermes'
  if (appInBackground()) { notifyInboxItem(item, kindLabel(item.kind), title); return }
  if ((item.kind === 'done' || item.kind === 'error') && item.sessionId && item.sessionId === state.openId) return
  toast(kindLabel(item.kind), item.kind.endsWith('error') ? 'error' : item.kind === 'done' || item.kind === 'paseo-done' ? 'success' : 'info', item.sessionId, title)
}

// Coming back to the foreground: reconnect the stream if it died while the app slept.
AppState.addEventListener('change', (s) => {
  if (s === 'active' && state.auth === 'offline' && !state.demo) { bootstrap(); return }
  if (s !== 'active' || state.auth !== 'ok') return
  if (!state.live) connectEvents()
  loadSessions()
  loadInbox()
})

export { ApiError }
