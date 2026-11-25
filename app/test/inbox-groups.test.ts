// node --test (Node strips the types): automation entries grouped in the inbox history, the filters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { InboxItem } from '../../shared/types.ts'
import { historyEntries, matchesKind, matchesSource, sourceFilterFrom } from '../../shared/inbox-groups.ts'

const item = (id: string, at: number, extra: Partial<InboxItem> = {}): InboxItem =>
  ({ id, kind: 'done', source: 'hermes', sessionId: null, title: id, text: '', at, read: false, ...extra })
const run = (id: string, at: number, group: string, extra: Partial<InboxItem> = {}) =>
  item(id, at, { kind: 'automation', source: 'cron', group, status: 'ok', ...extra })

test('automation runs fold into one group per source and name, placed at the newest run', () => {
  const entries = historyEntries([
    item('chat', 50),
    run('r1', 10, 'daily-report', { read: true }),
    run('r2', 90, 'daily-report'),
    run('d1', 70, 'disk-alert', { status: 'error' }),
    run('w1', 30, 'daily-report', { source: 'webhook' }),
  ])
  assert.deepEqual(entries.map((e) => (e.type === 'item' ? e.item.id : e.group.key)), ['cron:daily-report', 'cron:disk-alert', 'chat', 'webhook:daily-report'])
  const daily = entries[0].type === 'group' ? entries[0].group : null
  assert.ok(daily)
  assert.deepEqual(daily.items.map((x) => x.id), ['r2', 'r1'])
  assert.equal(daily.unread, 1)
  assert.equal(daily.at, 90)
  assert.equal(daily.status, 'ok')
  assert.equal(entries[1].type === 'group' && entries[1].group.status, 'error')
})

test('a group without a name falls back to the title, then the source', () => {
  const entries = historyEntries([item('n1', 5, { kind: 'automation', source: 'notify', title: 'Backup done' }), item('n2', 4, { kind: 'automation', source: 'notify', title: null })])
  assert.deepEqual(entries.map((e) => e.type === 'group' && e.group.name), ['Backup done', 'notify'])
})

test('kind filter: automation status decides done vs. error, requests stay requests', () => {
  assert.equal(matchesKind(run('a', 1, 'g'), 'done'), true)
  assert.equal(matchesKind(run('a', 1, 'g'), 'error'), false)
  assert.equal(matchesKind(run('a', 1, 'g', { status: 'error' }), 'error'), true)
  assert.equal(matchesKind(run('a', 1, 'g'), 'requests'), false)
  assert.equal(matchesKind(item('p', 1, { kind: 'paseo-limit', source: 'paseo' }), 'error'), true)
  assert.equal(matchesKind(item('q', 1, { kind: 'approval' }), 'requests'), true)
  assert.equal(matchesKind(item('q', 1, { kind: 'approval' }), 'done'), false)
})

test('source filter: chats, agents, automations; old stored values still work', () => {
  assert.equal(matchesSource('hermes', 'chats'), true)
  assert.equal(matchesSource('paseo', 'chats'), false)
  assert.equal(matchesSource('paseo', 'agents'), true)
  for (const s of ['cron', 'webhook', 'notify'] as const) assert.equal(matchesSource(s, 'automations'), true)
  assert.equal(matchesSource('hermes', 'automations'), false)
  assert.equal(sourceFilterFrom('hermes'), 'chats')
  assert.equal(sourceFilterFrom('paseo'), 'agents')
  assert.equal(sourceFilterFrom('automations'), 'automations')
  assert.equal(sourceFilterFrom('junk'), 'all')
  assert.equal(sourceFilterFrom(null), 'all')
})
