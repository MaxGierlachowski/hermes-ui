import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { formatCursor, parseCursor, sessionPage } from '../src/session-page.mjs';

const SYSTEM = new Set(['cron', 'tool', 'subagent', 'oneshot', 'webhook', 'kanban', 'api_server']);
const NOW = 1_800_000_000;

// The tables and columns of Hermes' state.db that Store reads for the board.
function fixture(build) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-page-'));
  const file = path.join(dir, 'state.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, created_source TEXT, title TEXT, started_at REAL, ended_at REAL, end_reason TEXT,
      last_activity_at REAL, last_activity_description TEXT, message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, parent_session_id TEXT, profile_name TEXT, model TEXT, model_config TEXT);
    CREATE INDEX idx_sessions_effective_activity ON sessions(COALESCE(last_activity_at, started_at) DESC, started_at DESC);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_name TEXT, tool_call_id TEXT,
      timestamp REAL, display_kind TEXT, display_metadata TEXT, active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0);
    CREATE INDEX idx_messages_session_id ON messages(session_id, id);
    CREATE TABLE session_admissions (seq INTEGER PRIMARY KEY, admission_id TEXT, target_session_id TEXT, status TEXT, outcome TEXT, payload_json TEXT);
    CREATE TABLE session_turn_leases (conversation_id TEXT, expires_at REAL);
  `);
  const session = db.prepare(`INSERT INTO sessions (id, source, title, started_at, last_activity_at, message_count, ended_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const message = db.prepare(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`);
  const add = (id, source, ts, { title = id, messages = 2, ended = ts, prompt = `Prompt of ${id}`, archived = 0 } = {}) => {
    session.run(id, source, title, ts - 60, ts, messages, ended, archived);
    if (messages) { message.run(id, 'user', prompt, ts - 60); message.run(id, 'assistant', `Reply in ${id}`, ts); }
  };
  build(add);
  db.close();
  return { store: new Store(file), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// A card as server.mjs builds it, reduced to what the page logic looks at.
const toCard = (row) => ({ id: row.id, system: SYSTEM.has(row.source) || /^\[Cron delivery/.test(row.first_prompt || ''), updatedAt: row.last_activity_at });
const page = (store, query, extra = {}) => sessionPage(new URLSearchParams(query), { store, systemSources: SYSTEM, toCard, now: NOW, ...extra });

function walk(store, query, extra) {
  const seen = [];
  let first = page(store, query, extra);
  seen.push(...first.sessions.map((s) => s.id));
  let cursor = first.nextCursor;
  let pages = 1;
  while (cursor) {
    const next = page(store, `${query}&before=${encodeURIComponent(cursor)}`, extra);
    seen.push(...next.sessions.map((s) => s.id));
    cursor = next.nextCursor;
    if (++pages > 100) throw new Error('cursor does not end');
  }
  return { first, seen, pages };
}

test('500 newer cron sessions do not hide 3 old chats: they are the whole first page', () => {
  const { store, cleanup } = fixture((add) => {
    for (let i = 0; i < 500; i++) add(`cron-${i}`, 'cron', NOW - i * 40);
    add('chat-a', 'telegram', NOW - 86400 * 2);
    add('chat-b', 'local', NOW - 86400 * 20);
    add('chat-c', 'slack', NOW - 86400 * 200);
  });
  try {
    const r = page(store, 'limit=50');
    assert.deepEqual(r.sessions.map((s) => s.id), ['chat-a', 'chat-b', 'chat-c']);
    assert.equal(r.nextCursor, null);
    // Old clients (days=3, no limit) still get their window, filtered before the limit.
    assert.deepEqual(page(store, 'days=3&system=0').sessions.map((s) => s.id), ['chat-a']);
  } finally { cleanup(); }
});

test('system=1 shows crons; the cursor walks every row once, without gaps, also on equal timestamps', () => {
  const { store, cleanup } = fixture((add) => {
    for (let i = 0; i < 500; i++) add(`cron-${String(i).padStart(3, '0')}`, 'cron', NOW - Math.floor(i / 3) * 40); // three per timestamp
    add('chat-a', 'telegram', NOW - 86400 * 2);
    add('chat-b', 'local', NOW - 86400 * 20);
    add('chat-c', 'slack', NOW - 86400 * 200);
  });
  try {
    const { first, seen, pages } = walk(store, 'limit=50&system=1');
    assert.equal(first.sessions.length, 50);
    assert.ok(first.sessions.every((s) => s.system));
    assert.equal(seen.length, 503);
    assert.equal(new Set(seen).size, 503);
    assert.equal(pages, 11);
    assert.deepEqual(seen.slice(-3), ['chat-a', 'chat-b', 'chat-c']);
    const real = walk(store, 'limit=2');
    assert.deepEqual(real.seen, ['chat-a', 'chat-b', 'chat-c']);
    assert.equal(real.pages, 2);
  } finally { cleanup(); }
});

test('cron deliveries mirrored into a chat, empty cron shells, hidden and archived rows stay out', () => {
  const { store, cleanup } = fixture((add) => {
    add('chat', 'local', NOW - 100);
    add('mirror', 'telegram', NOW - 200, { prompt: '[Cron delivery: daily report] …' });
    add('shell-old', 'cron', NOW - 300, { messages: 0, ended: null });
    add('shell-new', 'cron', NOW - 10 + 60, { messages: 0, ended: null }); // started 10 s ago: still starting
    add('gone', 'local', NOW - 400, { archived: 1 });
  });
  try {
    assert.deepEqual(page(store, 'limit=10').sessions.map((s) => s.id), ['chat']);
    assert.deepEqual(page(store, 'limit=10&system=1').sessions.map((s) => s.id), ['shell-new', 'chat', 'mirror']);
  } finally { cleanup(); }
});

test('pinned cards and drafts come on the first page only, and are never repeated by later pages', () => {
  const { store, cleanup } = fixture((add) => {
    for (let i = 0; i < 6; i++) add(`chat-${i}`, 'local', NOW - i * 100);
    add('pinned-old', 'local', NOW - 86400 * 300);
    add('pinned-cron', 'cron', NOW - 50);
  });
  try {
    const extra = { pinnedIds: ['chat-4', 'pinned-old', 'pinned-cron', 'missing'], drafts: [{ id: 'draft:1', system: false }] };
    const { first, seen } = walk(store, 'limit=2', extra);
    assert.deepEqual(first.sessions.map((s) => s.id), ['draft:1', 'chat-4', 'pinned-old', 'chat-0', 'chat-1']);
    assert.deepEqual(seen, ['draft:1', 'chat-4', 'pinned-old', 'chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-5']);
    // A pinned system card still needs system=1 unless it is a card the board created (toCard decides).
    assert.ok(page(store, 'limit=2&system=1', extra).sessions.some((s) => s.id === 'pinned-cron'));
  } finally { cleanup(); }
});

test('pinned Done cards are paged like the rest, at their own position, and keep their column', () => {
  const { store, cleanup } = fixture((add) => {
    for (let i = 0; i < 10; i++) add(`chat-${i}`, 'local', NOW - i * 100);
    for (let i = 0; i < 300; i++) add(`done-${String(i).padStart(3, '0')}`, 'local', NOW - 50 - i * 100); // between the chats, then older
    add('open-old', 'local', NOW - 86400 * 300);
    add('done-cron', 'cron', NOW - 25);
    add('done-ancient', 'local', NOW - 86400 * 5);
  });
  try {
    const overrides = { 'open-old': 'waiting', 'done-cron': 'done', 'done-ancient': 'done' };
    for (let i = 0; i < 300; i++) overrides[`done-${String(i).padStart(3, '0')}`] = 'done';
    const withColumn = (row) => ({ ...toCard(row), column: overrides[row.id] || 'waiting' });
    const extra = { pinnedIds: Object.keys(overrides), toCard: withColumn, drafts: [{ id: 'draft:1', system: false }] };
    const { first, seen, pages } = walk(store, 'limit=50', extra);
    // First page: draft + open pinned card + the 50 newest of chats and Done cards, merged by time.
    assert.equal(first.sessions.length, 52);
    assert.deepEqual(first.sessions.slice(0, 5).map((s) => s.id), ['draft:1', 'open-old', 'chat-0', 'done-000', 'chat-1']);
    assert.equal(first.sessions.find((s) => s.id === 'done-000').column, 'done');
    assert.ok(first.nextCursor);
    // Every card exactly once; the system Done card stays out without system=1.
    assert.equal(seen.length, 2 + 10 + 301);
    assert.equal(new Set(seen).size, seen.length);
    assert.ok(!seen.includes('done-cron'));
    assert.equal(pages, 7);
    assert.ok(walk(store, 'limit=50&system=1', extra).seen.includes('done-cron'));
    // The time window applies to Done cards too.
    const windowed = walk(store, 'days=1&limit=50', extra).seen;
    assert.ok(windowed.includes('done-299') && !windowed.includes('done-ancient') && windowed.includes('open-old'));
  } finally { cleanup(); }
});

test('cursor format: "<ts>:<id>", ids may contain colons; garbage is a 400', () => {
  assert.equal(formatCursor({ effective_at: 1763600000.123456, id: 'a:b' }), '1763600000.123456:a:b');
  assert.deepEqual(parseCursor('1763600000.123456:a:b'), { ts: 1763600000.123456, id: 'a:b' });
  assert.equal(parseCursor('nope'), null);
  const { store, cleanup } = fixture(() => {});
  try {
    assert.throws(() => page(store, 'before=nope'), (e) => e.status === 400);
    assert.deepEqual(page(store, ''), { sessions: [], nextCursor: null });
  } finally { cleanup(); }
});
