// The header's progress bar (SyncBar) counts requests the user is waiting for. Background refreshes
// (live reload events, reconnect catch-up, foreground resume, polling) run quietly instead, otherwise
// the bar of a running chat would sweep without a pause. No dependencies: unit-tested with node --test.

/** Longest a counted request may hold the bar; transports time out at 30 s, this is the backstop. */
export const TRACK_CAP_MS = 35_000

export class DeadlineError extends Error {}

/** Rejects after `ms` if `p` has not settled by then (a hung transport must not block the UI forever). */
export function deadline<T>(p: Promise<T>, ms = TRACK_CAP_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError('timed out')), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/**
 * A counter of tracked requests: `add(+1)` when one starts, `add(-1)` exactly once when it settles or
 * after `capMs`, whichever comes first, so the count cannot leak. `quiet` requests are not counted.
 */
export function makeTrack(add: (delta: number) => void, capMs = TRACK_CAP_MS) {
  return function track<T>(p: Promise<T>, quiet = false): Promise<T> {
    if (quiet) return p
    let counted = true
    const release = () => { if (counted) { counted = false; add(-1) } }
    add(1)
    const timer = setTimeout(release, capMs)
    return p.finally(() => { clearTimeout(timer); release() })
  }
}
