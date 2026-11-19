import { t } from './i18n'
// Board state: one small external store fed by REST + the /api/events SSE stream.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { api, Unauthorized } from './api'
import { apiUrl, getConnection, connectIroh, consumePairCode, sameOriginBackend, savedRemote, takePairingFragment } from './backend'
import type { Column, Device, InboxItem, OpenItem, OutgoingMessage, RemoteState, Session, Tab, ThreadMessage } from './types'

type State = {
  auth: 'unknown' | 'ok' | 'required' | 'no-backend'
  sessions: Record<string, Session>
  gateway: boolean
  live: boolean
  remote: RemoteState | null
  devices: Device[]
  isLocal: boolean
  days: number
  system: boolean
  search: string
  source: string
  openId: string | null
  messages: ThreadMessage[]
  loadingThread: boolean
  streaming: { id: string; text: string } | null
  pendingFirst: { id: string; text: string; ts: number } | null
  flash: string | null
  highlight: number | null // message id to scroll to and mark (search hit)
  highlightQuery: string
  tab: Tab
  inbox: { open: OpenItem[]; items: InboxItem[]; unread: number; loaded: boolean; paseo: { connected: boolean; canRespond: boolean } }
  confirm: { sessionId: string; promptId: string; choice: string } | null // approval from a notification action
}

let state: State = {
  auth: 'unknown',
  sessions: {},
  gateway: false,
  live: false,
  remote: null,
  devices: [],
  isLocal: true,
  days: Number(localStorage.getItem('hk_days') || 3),
  system: localStorage.getItem('hk_system') === '1',
  search: '',
  source: '',
  openId: null,
  messages: [],
  loadingThread: false,
  streaming: null,
  pendingFirst: null,
  flash: null,
  highlight: null,
  highlightQuery: '',
  tab: localStorage.getItem('hk_tab') === 'inbox' ? 'inbox' : 'board',
  inbox: { open: [], items: [], unread: 0, loaded: false, paseo: { connected: false, canRespond: false } },
  confirm: null,
}
const listeners = new Set<() => void>()
const set = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((l) => l())
}
export const getState = () => state
export function useBoard<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => select(state))
}

// Cards moved on the board but not yet confirmed by the backend: live events and reloads keep showing
// the new column until the move request settles, so a card never flips back mid-flight.
const movingTo = new Map<string, Column>()
const withMove = (s: Session): Session => {
  const column = movingTo.get(s.id)
  return column && s.column !== column ? { ...s, column } : s
}

function upsert(s: Session, flash = false) {
  s = withMove(s)
  set((st) => {
    const prev = st.sessions[s.id]
    return { sessions: { ...st.sessions, [s.id]: s }, flash: flash || (prev && prev.column !== s.column) ? s.id : st.flash }
  })
}
function remove(id: string) {
  set((st) => {
    const sessions = { ...st.sessions }
    delete sessions[id]
    return { sessions, openId: st.openId === id ? null : st.openId }
  })
}

const handle = (err: unknown) => {
  if (err instanceof Unauthorized) { set({ auth: 'required' }); return }
  // Over iroh a refused connection (device not paired / revoked, gateway down) surfaces as a network error.
  if (getConnection().mode === 'iroh' && err instanceof TypeError && state.auth !== 'ok') { set({ auth: 'required' }); return }
  toast.error(err instanceof Error ? err.message : String(err))
}

// ---------- loading ----------
export async function loadSessions() {
  try {
    const { sessions, gateway } = await api<{ sessions: Session[]; gateway: boolean }>(`/api/sessions?days=${state.days}&system=${state.system ? 1 : 0}`)
    set({ auth: 'ok', gateway, sessions: Object.fromEntries(sessions.map((s) => [s.id, withMove(s)])) })
    return true
  } catch (err) { handle(err); return false }
}

export async function loadRemote() {
  try {
    const r = await api<{ remote: RemoteState; devices: Device[]; local: boolean }>('/api/remote')
    set({ remote: r.remote, devices: r.devices, isLocal: r.local })
  } catch (err) { handle(err) }
}

export function setFilter(patch: Partial<Pick<State, 'days' | 'system' | 'search' | 'source'>>) {
  set(patch)
  if ('days' in patch) localStorage.setItem('hk_days', String(patch.days))
  if ('system' in patch) localStorage.setItem('hk_system', patch.system ? '1' : '0')
  if ('days' in patch || 'system' in patch) loadSessions()
}

// ---------- thread ----------
function withPending(id: string, messages: ThreadMessage[]) {
  const p = state.pendingFirst
  if (!p || p.id !== id) return messages
  if (messages.some((m) => m.role === 'user')) { set({ pendingFirst: null }); return messages }
  return [{ role: 'user' as const, text: p.text, ts: p.ts }, ...messages]
}

export async function openThread(id: string | null, opts: { highlight?: number; query?: string; session?: Session } = {}) {
  // A search hit can be older than the board's window: show its card until the next reload.
  if (id && opts.session && !state.sessions[id]) upsert(opts.session)
  set({ openId: id, messages: [], loadingThread: !!id, highlight: opts.highlight ?? null, highlightQuery: opts.query || '', streaming: state.streaming?.id === id ? state.streaming : null })
  writeHash()
  if (id) await refreshThread(id)
}

export const clearHighlight = () => set({ highlight: null })

export type SearchHit = { session: Session & { archived?: boolean }; hit?: { msgId: number; role: string; ts: number; snippet: string; hits: number }; alsoTitle?: boolean }
export async function searchChats(q: string, archived: boolean, signal?: AbortSignal) {
  return api<{ q: string; title: SearchHit[]; content: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}${archived ? '&archived=1' : ''}`, { signal })
}

export async function refreshThread(id: string) {
  try {
    const { session, messages } = await api<{ session: Session; messages: ThreadMessage[] }>(`/api/sessions/${encodeURIComponent(id)}`)
    if (state.openId !== id) return
    upsert(session)
    set({ messages: withPending(id, messages), loadingThread: false })
  } catch (err) { set({ loadingThread: false }); handle(err) }
}

// ---------- routing: #/board, #/board/<session>, #/inbox, #/inbox/<session>[?confirm=<prompt>&choice=<c>] ----------
// Legacy links (#<session>) open the board. Pairing fragments (#iroh=…) are handled by bootstrap().
function writeHash() {
  const h = `#/${state.tab}${state.openId ? `/${encodeURIComponent(state.openId)}` : ''}`
  if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h)
}
export function setTab(tab: Tab) {
  localStorage.setItem('hk_tab', tab)
  set({ tab })
  writeHash()
  if (tab === 'inbox' && !state.inbox.loaded) loadInbox()
}
export function applyHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '')
  if (!raw || /(^|&)iroh=/.test(raw)) { writeHash(); return }
  const [path, query] = raw.split('?')
  const m = path.match(/^\/(board|inbox)(?:\/(.+))?$/)
  const tab: Tab = m ? (m[1] as Tab) : 'board'
  const id = m ? (m[2] ? decodeURIComponent(m[2]) : null) : decodeURIComponent(path)
  if (tab !== state.tab) setTab(tab)
  const q = new URLSearchParams(query || '')
  if (id && q.get('confirm') && q.get('choice')) set({ confirm: { sessionId: id, promptId: q.get('confirm')!, choice: q.get('choice')! } })
  if (id && id !== state.openId) openThread(id)
  else if (!id && state.openId && m) openThread(null)
  else writeHash()
}
export const clearConfirm = () => set({ confirm: null })

// ---------- inbox ----------
export async function loadInbox() {
  try {
    const r = await api<{ open: OpenItem[]; items: InboxItem[]; unread: number; paseo: { connected: boolean; canRespond: boolean } }>('/api/inbox')
    set({ inbox: { ...r, loaded: true } })
  } catch (err) { handle(err) }
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
    await api(`/api/paseo/agents/${agentId}/permissions/${encodeURIComponent(requestId)}`, { method: 'POST', json: { decision, message } })
    toast.success(decision === 'allow' ? t('Paseo-Freigabe erteilt') : t('Paseo-Freigabe abgelehnt'))
    return true
  } catch (err) { handle(err); loadInbox(); return false }
}
export const badgeCount = (st = state) => st.inbox.open.length + st.inbox.unread

// App icon badge (Badging API: installed PWAs on iOS 16.4+, Chrome/Edge desktop).
let lastBadge = -1
function syncBadge() {
  const n = badgeCount()
  if (n === lastBadge) return
  lastBadge = n
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  try { (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {}) } catch { /* unsupported */ }
}
listeners.add(syncBadge)

const KIND_LABEL: Record<string, string> = {
  approval: 'Freigabe nötig', clarify: 'Rückfrage von Hermes', permission: 'Paseo-Agent braucht eine Freigabe',
  done: 'Fertig', error: 'Fehler', 'paseo-done': 'Paseo-Agent fertig', 'paseo-error': 'Paseo-Agent mit Fehler', 'paseo-limit': 'Paseo-Agent hat ein Limit erreicht',
}
export const kindLabel = (k: string) => t(KIND_LABEL[k] || k)

/** In-app notification while the app is visible; a click opens the thread (or the inbox). */
function toastFor(item: InboxItem) {
  if (document.visibilityState !== 'visible') return
  // A finished turn of the chat that is open right now needs no toast.
  if ((item.kind === 'done' || item.kind === 'error') && item.sessionId && item.sessionId === state.openId) return
  const request = item.kind === 'approval' || item.kind === 'clarify' || item.kind === 'permission'
  const open = () => {
    markRead([item.id])
    if (request || !item.sessionId) setTab('inbox')
    if (item.sessionId) openThread(item.sessionId)
  }
  const title = item.source === 'paseo' && item.agentTitle ? item.agentTitle : item.title || 'Hermes'
  const fn = item.kind.endsWith('error') || item.kind === 'paseo-limit' ? toast.error : request ? toast.warning : toast.success
  fn(`${kindLabel(item.kind)} · ${title}`, {
    id: item.id,
    description: item.text ? (item.text.length > 90 ? `${item.text.slice(0, 89)}…` : item.text) : undefined,
    duration: request ? 12000 : 6000,
    action: { label: request ? t('Ansehen') : t('Öffnen'), onClick: open },
  })
}

// ---------- actions ----------
export async function setColumn(id: string, column: Column | 'auto') {
  // Optimistic: the card moves at once (the board's drop animation lands there), rolled back on error.
  const before = state.sessions[id]
  const optimistic = column !== 'auto' && !!before && before.column !== column
  if (optimistic) {
    movingTo.set(id, column)
    upsert({ ...before, column, override: true }, true)
  }
  try {
    const res = await api<{ session: Session | null; removed?: string; replaced?: string }>(`/api/sessions/${encodeURIComponent(id)}/column`, { method: 'POST', json: { column } })
    if (movingTo.get(id) === column) movingTo.delete(id)
    if (res.removed || res.replaced) remove((res.removed || res.replaced)!)
    if (res.session) upsert(res.session, !optimistic)
    if (res.replaced && res.session && state.openId === null) return
    if (res.replaced && res.session) openThread(res.session.id)
  } catch (err) {
    if (movingTo.get(id) === column) movingTo.delete(id)
    if (optimistic && state.sessions[id]?.column === column) upsert({ ...state.sessions[id], column: before.column, override: before.override })
    if (optimistic && !(err instanceof Unauthorized)) toast.error(t('Karte konnte nicht verschoben werden'), { description: err instanceof Error ? err.message : String(err) })
    else handle(err)
    loadSessions()
  }
}

// Automated E2E runs mark their chats as "TEST · …" without any visible switch: they set
// localStorage hk_e2e_test=1 in their own browser profile (or POST test: true to the API directly).
const e2eTest = () => { try { return localStorage.getItem('hk_e2e_test') === '1' } catch { return false } }

export async function createChat(msg: OutgoingMessage) {
  const { session } = await api<{ session: Session }>('/api/sessions', { method: 'POST', json: e2eTest() ? { ...msg, test: true } : msg })
  upsert(session, true)
  if (!msg.draft) {
    set({ pendingFirst: { id: session.id, text: msg.text || (msg.audio ? '🎙 Sprachnachricht …' : ''), ts: Date.now() / 1000 } })
    openThread(session.id)
  }
  return session
}

/** false when the message was not delivered (already reported); the composer then keeps it. */
export async function sendMessage(id: string, msg: OutgoingMessage) {
  let res: { session: Session; messages?: ThreadMessage[]; voice?: { transcribed: boolean; error?: string } }
  try {
    res = await api(`/api/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', json: msg })
  } catch (err) {
    // The backend keeps the message as "failed" with "send again" in the thread; nothing is lost.
    if (err instanceof Unauthorized) throw err
    toast.error(t('Nachricht nicht zugestellt'), { description: err instanceof Error ? err.message : String(err) })
    refreshThread(id)
    return false
  }
  if (res.voice && !res.voice.transcribed) toast.error(t('Sprachnachricht nicht transkribiert – als Audiodatei gesendet'), { description: res.voice.error })
  if (res.session && res.session.id !== id) { remove(id); upsert(res.session, true); openThread(res.session.id); return true }
  if (res.session) upsert(res.session)
  if (res.messages && state.openId === id) set({ messages: res.messages })
  return true
}

async function outboxAction(sessionId: string, outboxId: string, retry: boolean) {
  try {
    const res = await api<{ session: Session; messages: ThreadMessage[] }>(`/api/outbox/${outboxId}${retry ? '/retry' : ''}`, { method: retry ? 'POST' : 'DELETE' })
    if (res.session) upsert(res.session)
    if (state.openId === sessionId) set({ messages: res.messages })
  } catch (err) { handle(err); refreshThread(sessionId) }
}
export const retryOutbox = (sessionId: string, outboxId: string) => outboxAction(sessionId, outboxId, true)
export const dismissOutbox = (sessionId: string, outboxId: string) => outboxAction(sessionId, outboxId, false)

export async function respond(id: string, body: { promptId: string; choice?: string; answer?: string; answers?: string[] }) {
  try {
    const res = await api<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}/respond`, { method: 'POST', json: body })
    if (res.session) upsert(res.session)
    return true
  } catch (err) { handle(err); refreshThread(id); return false }
}

export async function interrupt(id: string) {
  try { await api(`/api/sessions/${encodeURIComponent(id)}/interrupt`, { method: 'POST' }); toast('Stopp gesendet') } catch (err) { handle(err) }
}

export async function login(token: string) {
  await api('/api/login', { method: 'POST', json: { token, name: deviceName() } })
  set({ auth: 'ok' })
}
export async function redeemPairing(code: string) {
  await api('/api/pair/redeem', { method: 'POST', json: { code, name: deviceName() } })
  set({ auth: 'ok' })
}
export async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {})
  set({ auth: 'required' })
}
export async function revokeDevice(id: string) {
  try {
    const r = await api<{ devices: Device[] }>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
    set({ devices: r.devices })
  } catch (err) { handle(err) }
}
function deviceName() {
  const ua = navigator.userAgent
  const dev = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Browser'
  const br = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  return `${dev}${br ? ` · ${br}` : ''}`
}

// ---------- live events ----------
let es: EventSource | null = null
let reloadTimer: ReturnType<typeof setTimeout> | undefined
export function connectEvents() {
  es?.close()
  es = new EventSource(apiUrl('/api/events'), { withCredentials: true })
  es.onopen = () => set({ live: true })
  es.onerror = () => set({ live: false })
  const on = <T,>(name: string, fn: (d: T) => void) => es!.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)))
  on<Session>('session', (s) => {
    if (s.system && !state.system && !state.sessions[s.id]) return
    upsert(s)
  })
  on<{ id: string }>('removed', ({ id }) => remove(id))
  on<{ connected: boolean }>('gateway', ({ connected }) => set({ gateway: connected }))
  on<RemoteState>('remote', (remote) => set({ remote }))
  on<Device[]>('devices', (devices) => set({ devices }))
  on<{ open: OpenItem[]; unread: number }>('inbox', ({ open, unread }) => set((st) => ({ inbox: { ...st.inbox, open, unread } })))
  on<InboxItem>('inbox-item', (item) => {
    const known = state.inbox.items.some((x) => x.id === item.id)
    set((st) => ({ inbox: { ...st.inbox, items: known ? st.inbox.items.map((x) => (x.id === item.id ? item : x)) : [item, ...st.inbox.items] } }))
    if (!known) toastFor(item)
  })
  on<{ ids: string[] | 'all' }>('inbox-read', ({ ids }) => set((st) => ({ inbox: { ...st.inbox, items: st.inbox.items.map((x) => (ids === 'all' || ids.includes(x.id) ? { ...x, read: true } : x)) } })))
  on<{ id: string; text: string }>('delta', ({ id, text }) => {
    set((st) => ({ streaming: { id, text: (st.streaming?.id === id ? st.streaming.text : '') + text } }))
  })
  on<{ id: string; message: ThreadMessage }>('message', ({ id, message }) => {
    if (id !== state.openId) return
    set((st) => ({ messages: [...st.messages, message] }))
  })
  on<{ id: string; final: boolean }>('reload', ({ id, final }) => {
    if (final && state.streaming?.id === id) set({ streaming: null })
    if (id !== state.openId) return
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => refreshThread(id), 250)
  })
}

// ---------- startup ----------
// 1. a pairing link (#iroh=…&pair=…) → connect over iroh and redeem the code
// 2. a backend on our own origin → local mode (token / device cookie)
// 3. a remembered iroh endpoint → connect over iroh
// 4. nothing → ask for a pairing link
export async function bootstrap() {
  const fromLink = takePairingFragment()
  const remote = fromLink || ((await sameOriginBackend()) ? null : savedRemote())
  if (!remote) {
    if (location.pathname.endsWith('/pair')) return // legacy tunnel pairing, handled by <Login>
    if (await sameOriginBackend()) { await loadSessions(); return }
    set({ auth: 'no-backend' })
    return
  }
  await connectIroh(remote)
  const code = consumePairCode()
  if (code) {
    try { await api('/api/pair/redeem', { method: 'POST', json: { code, name: deviceName() } }); toast.success(t('Gerät gekoppelt')) } catch (err) { handle(err) }
  }
  await loadSessions()
}
