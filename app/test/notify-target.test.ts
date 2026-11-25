// node --test (Node strips the types): where a tap on a notification leads, for the backend's push URLs
// and the app's own local notifications. An inbox entry id must never be opened as a chat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTarget, targetUrl } from '../src/lib/notify-target.ts'

test('chat, inbox and entry routes', () => {
  assert.deepEqual(parseTarget('#/board/20261125_070000_ab12'), { tab: 'board', sessionId: '20261125_070000_ab12', itemId: null })
  assert.deepEqual(parseTarget('#/inbox/20261125_070000_ab12'), { tab: 'inbox', sessionId: '20261125_070000_ab12', itemId: null })
  assert.deepEqual(parseTarget('#/inbox'), { tab: 'inbox', sessionId: null, itemId: null })
  assert.deepEqual(parseTarget('#/board'), { tab: 'board', sessionId: null, itemId: null })
})

test('#/inbox/item/<id> is an inbox entry, not a session; ids are decoded', () => {
  const id = 'cron:job-disk:2026-11-25_07-00-00'
  assert.deepEqual(parseTarget(`#/inbox/item/${encodeURIComponent(id)}`), { tab: 'inbox', sessionId: null, itemId: id })
  assert.deepEqual(parseTarget('#/inbox/item/notify%3Aa%2Fb%7Cc'), { tab: 'inbox', sessionId: null, itemId: 'notify:a/b|c' })
  // Without an id there is nothing to focus: just the inbox.
  assert.deepEqual(parseTarget('#/inbox/item/'), { tab: 'inbox', sessionId: null, itemId: null })
  // A session that happens to be called "item" stays a session.
  assert.deepEqual(parseTarget('#/inbox/item'), { tab: 'inbox', sessionId: 'item', itemId: null })
  // On the board, item/ is not special.
  assert.equal(parseTarget('#/board/item%2Fx')?.sessionId, 'item/x')
})

test('full URLs, query strings and junk', () => {
  assert.deepEqual(parseTarget('https://ui.example/app/#/board/abc?confirm=p1&choice=once'), { tab: 'board', sessionId: 'abc', itemId: null })
  assert.equal(parseTarget('#/inbox/item/%E0%A4%A')?.itemId, '%E0%A4%A') // broken escape: kept as it is
  assert.equal(parseTarget('#/settings'), null)
  assert.equal(parseTarget('abc'), null)
  assert.equal(parseTarget(''), null)
  assert.equal(parseTarget(null), null)
})

test('the route of an entry matches the backend and parses back', () => {
  const run = { id: 'cron:job-disk:run-7', kind: 'automation' as const, sessionId: null }
  assert.equal(targetUrl(run), '#/inbox/item/cron%3Ajob-disk%3Arun-7')
  assert.equal(parseTarget(targetUrl(run))?.itemId, run.id)
  assert.equal(targetUrl({ ...run, sessionId: 's1' }), '#/board/s1')
  assert.equal(targetUrl({ id: 'req:p1', kind: 'approval', sessionId: 's1' }), '#/inbox/s1')
  assert.equal(targetUrl({ id: 'done:s1:4', kind: 'done', sessionId: 's1' }), '#/board/s1')
  assert.equal(targetUrl({ id: 'perm:x', kind: 'permission', sessionId: null }), '#/inbox')
})
