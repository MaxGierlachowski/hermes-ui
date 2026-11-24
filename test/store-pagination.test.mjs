import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';

// A minimal state.db: just the messages columns Store.messages()/messagesPage() read.
function fixture(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-store-'));
  const file = path.join(dir, 'state.db');
  const setup = new DatabaseSync(file);
  setup.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT,
      tool_name TEXT, tool_call_id TEXT, timestamp REAL, display_kind TEXT, display_metadata TEXT,
      compacted INTEGER DEFAULT 0, active INTEGER DEFAULT 1);`);
  const ins = setup.prepare(`INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, 's', ?, ?, ?)`);
  for (const r of rows) ins.run(r.id, r.role, r.content, r.id);
  setup.close();
  return new Store(file);
}

test('messagesPage returns the newest N first-page, oldest to newest, hasMore when more remain', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, role: 'user', content: `m${i + 1}` }));
  const store = fixture(rows);
  const { rows: page, hasMore } = store.messagesPage('s', { limit: 4 });
  assert.deepEqual(page.map((r) => r.id), [7, 8, 9, 10]);
  assert.equal(hasMore, true);
});

test('messagesPage with beforeId pages further back, and reports hasMore: false once exhausted', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, role: 'user', content: `m${i + 1}` }));
  const store = fixture(rows);
  const first = store.messagesPage('s', { limit: 4 });
  const second = store.messagesPage('s', { beforeId: first.rows[0].id, limit: 4 });
  assert.deepEqual(second.rows.map((r) => r.id), [3, 4, 5, 6]);
  assert.equal(second.hasMore, true);
  const third = store.messagesPage('s', { beforeId: second.rows[0].id, limit: 4 });
  assert.deepEqual(third.rows.map((r) => r.id), [1, 2]);
  assert.equal(third.hasMore, false);
});

test('messagesPage returns everything with hasMore: false when the window already covers it all', () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, role: 'user', content: `m${i + 1}` }));
  const store = fixture(rows);
  const { rows: page, hasMore } = store.messagesPage('s', { limit: 10 });
  assert.deepEqual(page.map((r) => r.id), [1, 2, 3]);
  assert.equal(hasMore, false);
});

test('messagesPage only sees the live transcript, same filter as messages()', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-store-'));
  const file = path.join(dir, 'state.db');
  const setup = new DatabaseSync(file);
  setup.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT,
      tool_name TEXT, tool_call_id TEXT, timestamp REAL, display_kind TEXT, display_metadata TEXT,
      compacted INTEGER DEFAULT 0, active INTEGER DEFAULT 1);`);
  setup.exec(`INSERT INTO messages (id, session_id, role, content, timestamp, active) VALUES
    (1, 's', 'user', 'a', 1, 1), (2, 's', 'user', 'b (undone)', 2, 0), (3, 's', 'system', 'c', 3, 1), (4, 's', 'user', 'd', 4, 1)`);
  setup.close();
  const store = new Store(file);
  const { rows } = store.messagesPage('s', { limit: 10 });
  assert.deepEqual(rows.map((r) => r.id), [1, 4]);
});
