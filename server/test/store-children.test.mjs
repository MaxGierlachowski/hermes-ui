import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { HermesAgents } from '../src/hermes-agents.mjs';

// The rows the board reads, in the shape Hermes writes them (messages table, tool_calls JSON, tool
// results as JSON, process_complete notices).
const ID = '98413df6-9375-4819-9d11-7252746a4028';
const fn = (id, name, args) => ({ id, call_id: id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function fixture() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hui-store-')), 'state.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, created_source TEXT, title TEXT, started_at REAL, ended_at REAL, end_reason TEXT,
      last_activity_at REAL, last_activity_description TEXT, message_count INTEGER, tool_call_count INTEGER, archived INTEGER, hidden INTEGER,
      parent_session_id TEXT, profile_name TEXT, model TEXT, model_config TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT,
      tool_name TEXT, timestamp REAL, active INTEGER NOT NULL DEFAULT 1, display_kind TEXT);`);
  db.prepare(`INSERT INTO sessions (id, source, started_at, last_activity_at, message_count) VALUES ('chat', 'local', 100, 1000, 9)`).run();
  const ins = db.prepare('INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, display_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const row = (role, ts, { content = '', callId = null, calls = null, tool = null, kind = null } = {}) => ins.run('chat', role, content, callId, calls && JSON.stringify(calls), tool, ts, kind);
  row('assistant', 100, { calls: [fn('c1', 'terminal', { command: 'cd ~/scratch && python3 paseo_oneshot.py', timeout: 120 })] });
  row('tool', 103, { callId: 'c1', tool: 'terminal', content: JSON.stringify({ output: JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({ id: ID }) }] }, jsonrpc: '2.0', id: 2 }), exit_code: 0, error: null }) });
  row('assistant', 200, { calls: [fn('c2', 'terminal', { command: `P=/Applications/Paseo.app/Contents/Resources/bin/paseo; ID=${ID}; $P send --no-wait $ID "go" && sleep 600; $P logs $ID`, background: true })] });
  row('tool', 200.5, { callId: 'c2', tool: 'terminal', content: JSON.stringify({ output: 'Background process started', session_id: 'proc_aa11', pid: 4242, exit_code: 0, error: null, notify_on_complete: true }) });
  row('assistant', 300, { calls: [fn('c3', 'terminal', { command: 'make release', timeout: 900 })] });
  row('tool', 300.2, { callId: 'c3', tool: 'terminal', content: JSON.stringify({ output: 'Background process started', session_id: 'proc_bb22', pid: 5353, exit_code: 0, error: null, promoted_from_foreground: 'Requested foreground timeout 900s exceeds the 600s cap …' }) });
  row('user', 400, { kind: 'process_complete', content: '[IMPORTANT: Background process proc_bb22 completed normally (exit code 0).\nCommand: make release\nOutput:\nok\n]' });
  row('assistant', 500, { calls: [fn('c4', 'terminal', { command: 'git status' })] });
  row('tool', 500.1, { callId: 'c4', tool: 'terminal', content: JSON.stringify({ output: 'x'.repeat(50000), exit_code: 0, error: null }) });
  db.close();
  return new Store(file);
}

test('store: background and promoted terminal calls make a chat a parent; results come back compact', () => {
  const store = fixture();
  assert.deepEqual(store.childRefs(0), ['chat']);
  const rows = store.childRows('chat');
  const big = rows.find((r) => r.tool_call_id === 'c4');
  assert.ok(big.content.length < 300, 'terminal output is not loaded');
  assert.deepEqual(JSON.parse(rows.find((r) => r.tool_call_id === 'c3').content), { session_id: 'proc_bb22', pid: 5353, exit_code: 0, error: null, promoted_from_foreground: 1 });
});

test('store + HermesAgents: the running background process is a child, the finished one too, foreground calls are not', () => {
  const store = fixture();
  const ha = new HermesAgents({ store, hermesHome: os.tmpdir(), isAlive: (pid) => pid === 4242, now: () => 1000 });
  ha.scan();
  const kids = ha.agentsFor('chat');
  assert.deepEqual(kids.map((a) => [a.id, a.kind, a.state]), [['hermes:default:proc_aa11', 'process', 'running'], ['hermes:default:proc_bb22', 'process', 'finished']]);
  assert.match(kids[0].title, /^paseo send --no-wait \$ID "go"/);
  assert.equal(ha.timeline('hermes:default:proc_bb22').items.length, 2);
});

test('store: terminal calls about Paseo are scanned for links, their results found by call id', () => {
  const store = fixture();
  const refs = store.paseoRefs(0).filter((r) => r.role === 'assistant');
  assert.equal(refs.length, 2); // the python script about Paseo and the CLI call; not make / git
  assert.match(store.toolResult('chat', 'c1').content, new RegExp(ID));
  assert.equal(store.toolResult('chat', 'nope'), null);
});
