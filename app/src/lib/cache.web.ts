// Web / desktop variant of cache.ts: the same synchronous API, backed by IndexedDB. Everything is
// loaded into memory once at startup (initCache, a few hundred KB at most: the newest THREADS threads
// with MESSAGES messages each), so reads stay synchronous and the first frame renders from the cache.
const MESSAGES = 80
const THREADS = 40
const PASEO = 20

type Entry<T> = { at: number; data: T }
const DB = 'hermes-cache'
const STORE = 'entries'

const mem = new Map<string, Entry<unknown>>()
let db: Promise<IDBDatabase | null> | null = null
const open = () => (db ??= new Promise((resolve) => {
  try {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  } catch { resolve(null) }
}))

let loaded: Promise<void> | null = null
export function initCache() {
  return (loaded ??= (async () => {
    const d = await open()
    if (!d) return
    await new Promise<void>((resolve) => {
      const tx = d.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve()
        if (!mem.has(String(c.key))) mem.set(String(c.key), c.value as Entry<unknown>)
        c.continue()
      }
      req.onerror = () => resolve()
    })
  })())
}

export function readCache<T>(key: string): Entry<T> | null {
  return (mem.get(key) as Entry<T>) ?? null
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let generation = 0

function put(key: string, e: Entry<unknown> | null) {
  open().then((d) => {
    if (!d) return
    const tx = d.transaction(STORE, 'readwrite')
    if (e) tx.objectStore(STORE).put(e, key)
    else tx.objectStore(STORE).delete(key)
  }).catch(() => { /* quota: only costs the cache */ })
}

/** Stores data for a key: in memory at once, in IndexedDB after a short debounce. */
export function writeCache<T>(key: string, data: T, delayMs = 400) {
  const e: Entry<T> = { at: Date.now(), data }
  mem.set(key, e)
  clearTimeout(timers.get(key))
  const gen = generation
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    if (gen !== generation) return
    put(key, e)
    const i = key.indexOf(':')
    if (i > 0) prune(key.slice(0, i))
  }, delayMs))
}

/** Keeps the newest entries of one family (thread:…, paseo:…). */
function prune(family: string) {
  const keep = family === 'thread' ? THREADS : PASEO
  const keys = [...mem.entries()].filter(([k]) => k.startsWith(`${family}:`)).sort((a, b) => b[1].at - a[1].at)
  for (const [k] of keys.slice(keep)) { mem.delete(k); put(k, null) }
}

export const trimMessages = <T,>(messages: T[]) => (messages.length > MESSAGES ? messages.slice(-MESSAGES) : messages)

export function clearCache() {
  generation++
  timers.forEach(clearTimeout)
  timers.clear()
  mem.clear()
  open().then((d) => d?.transaction(STORE, 'readwrite').objectStore(STORE).clear()).catch(() => {})
}
