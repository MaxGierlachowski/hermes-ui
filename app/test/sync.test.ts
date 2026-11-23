// node --test (Node strips the types): the progress-bar counter and the request deadline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deadline, DeadlineError, makeTrack } from '../src/lib/sync.ts'

const counter = () => {
  const c = { n: 0, max: 0 }
  const track = makeTrack((d) => { c.n += d; c.max = Math.max(c.max, c.n) }, 50)
  return { c, track }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('quiet requests never touch the counter', async () => {
  const { c, track } = counter()
  assert.equal(await track(Promise.resolve(1), true), 1)
  await assert.rejects(track(Promise.reject(new Error('x')), true))
  assert.deepEqual(c, { n: 0, max: 0 })
})

test('tracked requests count while pending and release on success and on failure', async () => {
  const { c, track } = counter()
  let ok!: (v: number) => void
  const a = track(new Promise<number>((r) => { ok = r }))
  const b = track(Promise.reject(new Error('boom')))
  assert.equal(c.n, 2)
  await assert.rejects(b)
  assert.equal(c.n, 1)
  ok(7)
  assert.equal(await a, 7)
  assert.equal(c.n, 0)
})

test('a request that never settles releases the counter after the cap, exactly once', async () => {
  const { c, track } = counter()
  let ok!: () => void
  const hung = track(new Promise<void>((r) => { ok = r }))
  track(new Promise(() => {})) // never settles at all
  assert.equal(c.n, 2)
  await sleep(80)
  assert.equal(c.n, 0)
  ok()
  await hung
  assert.equal(c.n, 0) // the late answer does not count down a second time
})

test('deadline rejects a hung promise and passes a fast one through', async () => {
  await assert.rejects(deadline(new Promise(() => {}), 20), DeadlineError)
  assert.equal(await deadline(Promise.resolve('ok'), 20), 'ok')
  await assert.rejects(deadline(Promise.reject(new Error('own')), 20), /own/)
})
