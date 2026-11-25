// Automations in the inbox: which cron / webhook runs "reported something" (src/automations.mjs), and the
// watcher over a rebuilt $HERMES_HOME (cron/output archives, jobs.json, a state.db excerpt). Generic names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Automations, classifyRun, isSilence } from '../src/automations.mjs';
import { Inbox } from '../src/inbox.mjs';
import { Store } from '../src/store.mjs';

// ---------- run archives as Hermes writes them (cron/scheduler.py, cron/scheduler_prompt.py) ----------
const header = (name, id, mode) => `# Cron Job: ${name}\n\n**Job ID:** ${id}\n**Run Time:** 2026-11-25 09:00:00\n**Mode:** ${mode}\n`;
const agentDoc = (name, id, response, { prompt = 'Summarise the night.', stampDelta = 0 } = {}) =>
  `# Cron Job: ${name}\n\n**Job ID:** ${id}\n**Run Time:** 2026-11-25 09:00:00\n**Schedule:** 0 9 * * *\n\n`
  + `**Prompt Characters:** ${Array.from(prompt).length + stampDelta}\n## Prompt\n\n${prompt}\n\n`
  + `**Response Characters:** ${Array.from(response).length}\n## Response\n\n${response}\n`;
const failedDoc = (name, id, error) =>
  `# Cron Job: ${name} (FAILED)\n\n**Job ID:** ${id}\n**Run Time:** 2026-11-25 09:00:00\n**Schedule:** 0 9 * * *\n\n## Prompt\n\nCheck it.\n\n`
  + `## Error\n\n\`\`\`\nTraceback (most recent call last):\n  File "x.py", line 1\n${error}\n\`\`\`\n`;
const scriptDoc = (name, id, output) => `${header(name, id, 'no_agent (script)')}\n---\n\n${output}\n`;
const blockedDoc = (name, id) => `# Cron Job: ${name}\n\n**Job ID:** ${id}\n**Run Time:** 2026-11-25 09:00:00\n**Status:** BLOCKED (configuration)\n\n`
  + 'The pre-run configuration check found a problem, so the agent did not run (nothing was charged).\n\n**Reason:** no model configured\n';

// ---------- isSilence: Hermes' autonomous-lane rule, nothing else ----------
test('isSilence: the [SILENT] marker and its documented variants', () => {
  for (const s of ['[SILENT]', ' [silent] ', '`[SILENT]`', '```\n[SILENT]\n```', 'SILENT', 'NO_REPLY', '[SILENT] nothing new', '[SILENT].', '[SILNET]', '[SILEN']) {
    assert.equal(isSilence(s), true, JSON.stringify(s));
  }
});
test('isSilence: real reports, also ones that mention silence, are not silent', () => {
  for (const s of ['', 'All good, 3 backups verified.', 'Nothing to report today.', 'The job stays [SILENT] when idle, but today: disk at 91 %.', 'no_change']) {
    assert.equal(isSilence(s), false, JSON.stringify(s));
  }
});

// ---------- classifyRun ----------
test('classifyRun: silent and suppressed runs', () => {
  assert.equal(classifyRun(`${header('disk-alert', 'a1', 'no_agent (script)')}**Status:** silent (empty output)\n`).status, 'silent');
  assert.equal(classifyRun(`${header('disk-alert', 'a1', 'no_agent (script)')}**Status:** silent (wakeAgent=false)\n`).status, 'silent');
  assert.equal(classifyRun(`${header('queue-watch', 'a2', 'monitor')}**Status:** no_change (agent run suppressed)\n`).status, 'silent');
  assert.equal(classifyRun(agentDoc('daily-report', 'a3', '[SILENT]')).status, 'silent');
  assert.equal(classifyRun(scriptDoc('disk-alert', 'a1', '[SILENT]')).status, 'silent');
});

test('classifyRun: an agent run that reported something', () => {
  const r = classifyRun(agentDoc('daily-report', 'a3', '## Daily report\n\n- 3 backups verified\n- **1** warning'));
  assert.deepEqual(r, { jobId: 'a3', jobName: 'daily-report', mode: 'agent', status: 'ok', title: 'Daily report', body: '## Daily report\n\n- 3 backups verified\n- **1** warning' });
});

test('classifyRun: a wrong prompt stamp still finds the length-framed response', () => {
  // Hermes' stamp is sometimes off (the stamped prompt is not the written one); the response frame decides.
  const r = classifyRun(agentDoc('daily-report', 'a3', 'Report 🧾 done', { prompt: 'Prompt that quotes **Response Characters:** 3\n## Response\n\nfoo', stampDelta: 12 }));
  assert.equal(r.status, 'ok');
  assert.equal(r.body, 'Report 🧾 done');
  // Astral characters count as one (Hermes counts code points).
  assert.equal(classifyRun(agentDoc('daily-report', 'a3', '🧾🧾 two receipts')).body, '🧾🧾 two receipts');
});

test('classifyRun: failures', () => {
  const failed = classifyRun(failedDoc('daily-report', 'a3', 'RuntimeError: HTTP 429: rate limited'));
  assert.equal(failed.status, 'error');
  assert.equal(failed.title, 'Run failed: RuntimeError: HTTP 429: rate limited');
  assert.match(failed.body, /^## Error/);
  const blocked = classifyRun(blockedDoc('backup-check', 'b1'));
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.title, 'BLOCKED (configuration)');
  assert.match(blocked.body, /no model configured/);
  const script = classifyRun(`${header('disk-alert', 'a1', 'no_agent (script)')}**Status:** script failed\n\nexit 2: /data not mounted\n`);
  assert.deepEqual([script.status, script.title, script.mode, script.body], ['error', 'script failed', 'script', 'exit 2: /data not mounted']);
  const marker = classifyRun(agentDoc('daily-report', 'a3', '[CRON_FAILURE]\nThe export API returned 500 three times.'));
  assert.deepEqual([marker.status, marker.title], ['error', 'The export API returned 500 three times.']);
  assert.equal(classifyRun(agentDoc('daily-report', 'a3', '(No response generated)')).status, 'error');
  const dropped = classifyRun('# Cron job removed before firing (run time outside grace window)\n\n- job id: c1\n- name: reminder\n- grace window: 120s\n\nThe job was removed without running.\n');
  assert.deepEqual([dropped.status, dropped.jobId, dropped.jobName], ['error', 'c1', 'reminder']);
  assert.equal(classifyRun('# Cron Job: c1 (FAILED)\n\njob not found\n').status, 'error');
});

test('classifyRun: script output is the report', () => {
  const r = classifyRun(scriptDoc('disk-alert', 'a1', '# Disk usage\n\n/data at 91 %'));
  assert.deepEqual([r.status, r.mode, r.title, r.body], ['ok', 'script', 'Disk usage', '# Disk usage\n\n/data at 91 %']);
  // A status line inside the output is the script's text, not the run header.
  assert.equal(classifyRun(scriptDoc('disk-alert', 'a1', '**Status:** silent\nbut really: 91 %')).status, 'ok');
});

// ---------- the watcher over a rebuilt $HERMES_HOME ----------
const settle = () => new Promise((r) => setTimeout(r, 400)); // Inbox.save() is debounced
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-automations-'));
  const home = path.join(root, 'hermes');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(home, 'cron', 'output'), { recursive: true });
  fs.writeFileSync(path.join(home, 'cron', 'jobs.json'), JSON.stringify({ jobs: [
    { id: 'j1', name: 'daily-report' }, { id: 'j2', name: 'disk-alert', no_agent: true }, { id: 'j3', name: 'backup-check' }, { id: 'j4', name: 'noisy-job' },
  ] }));
  const db = new DatabaseSync(path.join(home, 'state.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, created_source TEXT, title TEXT, started_at REAL, ended_at REAL,
      end_reason TEXT, last_activity_at REAL, last_activity_description TEXT, message_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, parent_session_id TEXT,
      profile_name TEXT, model TEXT, origin_json TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT,
      tool_name TEXT, tool_call_id TEXT, timestamp REAL, display_kind TEXT, display_metadata TEXT,
      active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0);`);
  db.close();
  const now = { t: 1_800_000_000 };
  const open = (opts = {}) => {
    const inbox = new Inbox(data, { maxDays: 100000 });
    const seen = [];
    const auto = new Automations({ hermesHome: home, dataDir: data, store: new Store(path.join(home, 'state.db')), inbox, now: () => now.t, onItem: (item, info) => seen.push({ id: item.id, ...info }), log: (s) => { throw new Error(s); }, ...opts });
    return { inbox, auto, seen };
  };
  const archive = (jobId, stamp, doc, at) => {
    const dir = path.join(home, 'cron', 'output', jobId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${stamp}.md`);
    fs.writeFileSync(file, doc);
    fs.utimesSync(file, at, at);
    fs.utimesSync(dir, at, at);
  };
  const session = (row, messages = []) => {
    const w = new DatabaseSync(path.join(home, 'state.db'));
    w.prepare('INSERT INTO sessions (id, source, title, started_at, ended_at, end_reason, last_activity_at, message_count, origin_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.source, row.title ?? null, row.started_at, row.ended_at ?? null, row.end_reason ?? null, row.ended_at ?? row.started_at, messages.length, row.origin_json ?? null);
    for (const [role, content] of messages) w.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(row.id, role, content, row.started_at);
    w.close();
  };
  return { root, home, data, now, open, archive, session, done: async () => { await settle(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('watcher: starts at "now", picks up new runs once, links agent runs to their chat', async () => {
  const f = fixture();
  const T = f.now.t;
  // Before the first start: must not flood the inbox.
  f.archive('j1', '2026-11-25_08-00-00', agentDoc('daily-report', 'j1', 'Old report'), T - 3600);
  let { inbox, auto, seen } = f.open();
  assert.equal(auto.scan(), 0);
  assert.equal(inbox.items.length, 0);

  // New runs: a report (with its chat), a silent script, a failing script, a blocked job.
  f.session({ id: 'local-abc', source: 'cron', title: 'daily-report · Nov 25 09:00', started_at: T + 5, ended_at: T + 58, end_reason: 'cron_complete' },
    [['user', 'Summarise the night.'], ['assistant', '## Daily report\n\nAll 3 backups verified.']]);
  f.archive('j1', '2026-11-25_09-00-00', agentDoc('daily-report', 'j1', '## Daily report\n\nAll 3 backups verified.'), T + 60);
  f.archive('j2', '2026-11-25_09-01-00', `${header('disk-alert', 'j2', 'no_agent (script)')}**Status:** silent (empty output)\n`, T + 61);
  f.archive('j2', '2026-11-25_09-02-00', `${header('disk-alert', 'j2', 'no_agent (script)')}**Status:** script failed\n\nexit 2\n`, T + 62);
  f.archive('j3', '2026-11-25_09-03-00', blockedDoc('backup-check', 'j3'), T + 63);
  f.now.t = T + 70;
  assert.equal(auto.scan(), 3);
  const byGroup = Object.fromEntries(inbox.items.map((x) => [x.group, x]));
  assert.deepEqual(Object.keys(byGroup).sort(), ['backup-check', 'daily-report', 'disk-alert']);
  assert.deepEqual(
    { ...byGroup['daily-report'], read: null },
    { id: 'cron:j1:2026-11-25_09-00-00', kind: 'automation', source: 'cron', group: 'daily-report', status: 'ok', title: 'Daily report', text: 'Daily report All 3 backups verified.', body: '## Daily report\n\nAll 3 backups verified.', sessionId: 'local-abc', at: T + 60, jobId: 'j1', read: null },
  );
  assert.equal(byGroup['disk-alert'].status, 'error');
  assert.equal(byGroup['disk-alert'].sessionId, null); // no-agent script: no chat
  assert.equal(byGroup['backup-check'].title, 'BLOCKED (configuration)');
  assert.equal(seen.length, 3);

  // Same scan again, and a restart: no duplicates.
  assert.equal(auto.scan(), 0);
  await settle();
  ({ inbox, auto } = f.open());
  assert.equal(auto.scan(), 0);
  assert.equal(inbox.items.length, 3);
  await f.done();
});

test('watcher: the same error again is folded into one entry (repeat counter, unread again)', async () => {
  const f = fixture();
  const T = f.now.t;
  const { inbox, auto, seen } = f.open();
  f.archive('j3', '2026-11-25_09-00-00', blockedDoc('backup-check', 'j3'), T + 10);
  auto.scan();
  inbox.markRead('all');
  f.archive('j3', '2026-11-25_10-00-00', blockedDoc('backup-check', 'j3'), T + 3610);
  f.archive('j3', '2026-11-25_11-00-00', blockedDoc('backup-check', 'j3'), T + 7210);
  auto.scan();
  assert.equal(inbox.items.length, 1);
  assert.deepEqual([inbox.items[0].repeat, inbox.items[0].read, inbox.items[0].at], [3, false, T + 7210]);
  assert.deepEqual(seen.map((s) => s.repeat), [false, true, true]);
  // A different error is a new entry.
  f.archive('j3', '2026-11-25_12-00-00', failedDoc('backup-check', 'j3', 'RuntimeError: boom'), T + 10810);
  auto.scan();
  assert.equal(inbox.items.length, 2);
  await f.done();
});

test('watcher: a run that becomes visible after a newer one is still picked up, once', async () => {
  const f = fixture();
  const T = f.now.t;
  const { inbox, auto } = f.open();
  f.archive('j2', '2026-11-25_09-00-05', scriptDoc('disk-alert', 'j2', 'second'), T + 5);
  assert.equal(auto.scan(), 1);
  // Written at T+3 but renamed into place only now (a slow write).
  f.archive('j1', '2026-11-25_09-00-03', scriptDoc('daily-report', 'j1', 'first'), T + 3);
  fs.utimesSync(path.join(f.home, 'cron', 'output', 'j1'), T + 6, T + 6);
  assert.equal(auto.scan(), 1);
  assert.equal(auto.scan(), 0);
  assert.deepEqual(inbox.items.map((x) => x.text).sort(), ['first', 'second']);
  await f.done();
});

test('watcher: backfill on the first start, ignore list', async () => {
  const f = fixture();
  const T = f.now.t;
  f.archive('j1', '2026-11-24_06-00-00', agentDoc('daily-report', 'j1', 'Yesterday'), T - 27 * 3600);
  f.archive('j1', '2026-11-25_06-00-00', agentDoc('daily-report', 'j1', 'Three hours ago'), T - 3 * 3600);
  f.archive('j4', '2026-11-25_07-00-00', scriptDoc('noisy-job', 'j4', 'chatter'), T - 2 * 3600);
  const { inbox, auto } = f.open({ backfillHours: 6, ignore: ['NOISY-JOB'] });
  assert.equal(auto.scan(), 1);
  assert.deepEqual(inbox.items.map((x) => x.text), ['Three hours ago']);
  await f.done();
});

test('watcher: webhook runs that replied, not the silent or empty ones', async () => {
  const f = fixture();
  const T = f.now.t;
  const { inbox, auto } = f.open();
  const origin = JSON.stringify({ platform: 'webhook', chat_name: 'webhook/ci-pipeline' });
  f.session({ id: 'wh-1', source: 'webhook', title: 'Pipeline failed on main', started_at: T + 1, ended_at: T + 20, end_reason: 'webhook_complete', origin_json: origin },
    [['user', '[Webhook delivery: ci-pipeline] {...}'], ['assistant', '**Pipeline #42 failed** in the test stage.']]);
  f.session({ id: 'wh-2', source: 'webhook', started_at: T + 2, ended_at: T + 21, end_reason: 'webhook_complete', origin_json: origin }, [['user', 'x'], ['assistant', '[SILENT]']]);
  f.session({ id: 'wh-3', source: 'webhook', started_at: T + 3, ended_at: T + 22, end_reason: 'webhook_complete', origin_json: origin }, [['user', 'x']]);
  f.session({ id: 'wh-old', source: 'webhook', started_at: T - 100, ended_at: T - 50, end_reason: 'webhook_complete', origin_json: origin }, [['user', 'x'], ['assistant', 'before the start']]);
  assert.equal(auto.scan(), 1);
  assert.deepEqual(
    [inbox.items[0].id, inbox.items[0].source, inbox.items[0].group, inbox.items[0].status, inbox.items[0].title, inbox.items[0].sessionId],
    ['webhook:wh-1', 'webhook', 'ci-pipeline', 'ok', 'Pipeline #42 failed in the test stage.', 'wh-1'],
  );
  assert.equal(auto.scan(), 0);
  await f.done();
});

test('watcher: no Hermes cron directory or state.db is not an error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-automations-empty-'));
  const inbox = new Inbox(path.join(root, 'data'));
  const auto = new Automations({ hermesHome: path.join(root, 'nothing'), dataDir: path.join(root, 'data'), store: null, inbox });
  assert.equal(auto.scan(), 0);
  await settle();
  fs.rmSync(root, { recursive: true, force: true });
});

test('server: a cron run that reported something shows up in /api/inbox (backfill), Board stays without it', async () => {
  const { startServer, fakeHermesState } = await import('./helpers/server.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-automations-srv-'));
  const home = path.join(root, 'hermes');
  const dir = path.join(home, 'cron', 'output', 'j9');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-11-25_09-00-00.md'), scriptDoc('daily-report', 'j9', '# Daily report\n\nAll green.'));
  fs.writeFileSync(path.join(dir, '2026-11-25_09-30-00.md'), `${header('daily-report', 'j9', 'no_agent (script)')}**Status:** silent (empty output)\n`);
  await fakeHermesState(path.join(home, 'state.db'), [
    { id: 'chat-1', title: 'A chat', messages: [{ role: 'user', content: 'hi' }] },
    { id: 'cron-1', source: 'cron', title: 'daily-report · Nov 25 09:00', messages: [{ role: 'user', content: 'run' }, { role: 'assistant', content: 'All green.' }] },
  ]);
  const srv = await startServer({ HERMES_UI_TOKEN: 'tok-auto', HERMES_HOME: home, HERMES_UI_AUTOMATIONS_BACKFILL_HOURS: '1' });
  try {
    const get = async (p) => (await fetch(`${srv.base}${p}`, { headers: { authorization: 'Bearer tok-auto' } })).json();
    let items = [];
    for (let i = 0; i < 40 && !items.length; i++) { await new Promise((r) => setTimeout(r, 100)); items = (await get('/api/inbox')).items; }
    assert.deepEqual(items.map((x) => [x.kind, x.source, x.group, x.status, x.title, x.sessionId]), [['automation', 'cron', 'daily-report', 'ok', 'Daily report', null]]);
    assert.equal((await get('/api/inbox')).unread, 1);
    const board = JSON.stringify(await get('/api/sessions'));
    assert.match(board, /chat-1/);
    assert.doesNotMatch(board, /cron-1/);
  } finally {
    await srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
