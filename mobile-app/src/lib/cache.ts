// Persistent stale-while-revalidate cache: what the screens showed last, as small JSON files in the
// app's documents directory. Read synchronously at startup and on navigation (the board, inbox and a
// thread render from it in the first frame), written debounced after every fresh load or live event.
// Bounded: the newest THREADS threads and PASEO transcripts, the last MESSAGES messages each; media
// files are capped by size (connection.ts). Removed on unpairing.
import { Directory, File, Paths } from 'expo-file-system'

const MESSAGES = 80
const THREADS = 40
const PASEO = 20

type Entry<T> = { at: number; data: T }

let dirRef: Directory | null = null
const dir = () => {
  if (!dirRef) {
    dirRef = new Directory(Paths.document, 'hermes-cache')
    if (!dirRef.exists) dirRef.create({ intermediates: true, idempotent: true })
  }
  return dirRef
}

const hash = (s: string) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}
// board / inbox keep their names; per-chat and per-agent entries are hashed into a prefix family.
const fileName = (key: string) => {
  const i = key.indexOf(':')
  return i < 0 ? `${key}.json` : `${key.slice(0, i)}-${hash(key.slice(i + 1))}.json`
}

// Recent reads/writes stay in memory, so going back and forth between screens never touches the disk.
const mem = new Map<string, Entry<unknown>>()
const MEM_MAX = 60
const remember = (key: string, e: Entry<unknown>) => {
  mem.delete(key)
  mem.set(key, e)
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!)
}

export function readCache<T>(key: string): Entry<T> | null {
  const m = mem.get(key)
  if (m) return m as Entry<T>
  try {
    const f = new File(dir(), fileName(key))
    if (!f.exists) return null
    const e = JSON.parse(f.textSync()) as Entry<T>
    remember(key, e)
    return e
  } catch { return null }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let generation = 0

/** Stores data for a key: in memory at once, on disk after a short debounce (live events come in bursts). */
export function writeCache<T>(key: string, data: T, delayMs = 400) {
  const e: Entry<T> = { at: Date.now(), data }
  remember(key, e)
  clearTimeout(timers.get(key))
  const gen = generation
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    if (gen !== generation) return
    try {
      new File(dir(), fileName(key)).write(JSON.stringify(e))
      if (key.includes(':')) prune(key.slice(0, key.indexOf(':')))
    } catch { /* a full disk only costs the cache */ }
  }, delayMs))
}

/** Keeps the newest files of one family (thread-…, paseo-…). */
function prune(family: string) {
  const keep = family === 'thread' ? THREADS : PASEO
  try {
    const files = dir().list().filter((f): f is File => f instanceof File && f.name.startsWith(`${family}-`))
    if (files.length <= keep) return
    files
      .map((f) => ({ f, t: f.modificationTime ?? 0 }))
      .sort((a, b) => b.t - a.t)
      .slice(keep)
      .forEach(({ f }) => { try { f.delete() } catch { /* already gone */ } })
  } catch { /* listing failed: try again next write */ }
}

/** The last MESSAGES messages of a thread are enough to render it at once; the rest comes from the backend. */
export const trimMessages = <T,>(messages: T[]) => (messages.length > MESSAGES ? messages.slice(-MESSAGES) : messages)

/** Unpairing: everything this backend showed goes. */
export function clearCache() {
  generation++
  timers.forEach(clearTimeout)
  timers.clear()
  mem.clear()
  try { dir().delete() } catch { /* nothing cached */ }
  dirRef = null
}
