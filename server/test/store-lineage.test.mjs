import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';

// Sessions with parent_session_id: a continued chat (child, grandchild), a subagent row, a parent cycle.
function fixture() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hui-lineage-')), 'state.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, started_at REAL, parent_session_id TEXT);');
  const ins = db.prepare('INSERT INTO sessions (id, source, started_at, parent_session_id) VALUES (?, ?, ?, ?)');
  ins.run('root', 'local', 1, null);
  ins.run('child', 'local', 2, 'root');
  ins.run('grandchild', 'local', 3, 'child');
  ins.run('sub', 'subagent', 4, 'root');
  ins.run('loop-a', 'local', 5, 'loop-b');
  ins.run('loop-b', 'local', 6, 'loop-a');
  db.close();
  return new Store(file);
}

test('rootOf: child and grandchild sessions roll up to the root the board shows', () => {
  const store = fixture();
  assert.equal(store.rootOf('root'), 'root');
  assert.equal(store.rootOf('child'), 'root');
  assert.equal(store.rootOf('grandchild'), 'root');
  assert.equal(store.rootOf('sub'), 'root');
});

test('rootOf: unknown sessions give null; a parent cycle ends without hanging', () => {
  const store = fixture();
  assert.equal(store.rootOf('nope'), null);
  assert.ok(['loop-a', 'loop-b'].includes(store.rootOf('loop-a')));
});
