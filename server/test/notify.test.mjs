// POST /api/notify and `hermes-ui notify`: free messages from scripts land in the inbox as automation
// entries (source notify). Validation, size limit, the board token and the notify-only token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNotify, previewText } from '../src/notify.mjs';
import { startServer } from './helpers/server.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hermes-ui.mjs');
const TOKEN = 'test-token-notify';
const NOTIFY_TOKEN = 'test-token-notify-only';
let srv;

test.before(async () => { srv = await startServer({ HERMES_UI_TOKEN: TOKEN, HERMES_UI_NOTIFY_TOKEN: NOTIFY_TOKEN }, { sessions: [] }); });
test.after(async () => { await srv?.stop(); });

const post = (body, token = TOKEN) => fetch(`${srv.base}/api/notify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const inboxItems = async () => (await (await fetch(`${srv.base}/api/inbox`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).items;

// ---- parseNotify ----

test('parseNotify: a full message becomes an automation entry', () => {
  const e = parseNotify({ title: ' Disk alert ', text: '## Disk\n\n- **/data** at 91 %\n', group: 'disk-alert', level: 'warn', sessionId: 'sess_1.a:b-c', url: 'https://example.com/x' });
  assert.match(e.id, /^notify:[0-9a-f-]{36}$/);
  assert.deepEqual({ ...e, id: null }, {
    id: null, kind: 'automation', source: 'notify', group: 'disk-alert', status: 'ok', level: 'warn', title: 'Disk alert',
    text: 'Disk /data at 91 %', body: '## Disk\n\n- **/data** at 91 %', link: 'https://example.com/x', sessionId: 'sess_1.a:b-c',
  });
});

test('parseNotify: defaults (group notify, level info, no text, no session); error level means status error', () => {
  const e = parseNotify({ title: 'daily-report' });
  assert.equal(e.group, 'notify');
  assert.equal(e.level, 'info');
  assert.equal(e.status, 'ok');
  assert.equal(e.text, '');
  assert.equal(e.sessionId, null);
  assert.equal('link' in e, false);
  assert.equal(parseNotify({ title: 'x', level: 'error' }).status, 'error');
  assert.notEqual(parseNotify({ title: 'x' }).id, parseNotify({ title: 'x' }).id);
});

test('parseNotify: invalid input is a 400', () => {
  const cases = [
    null, [], 'x', {}, { title: '' }, { title: '   ' }, { title: 3 }, { title: 'x'.repeat(201) },
    { title: 'x', text: 5 }, { title: 'x', text: 'y'.repeat(8001) },
    { title: 'x', group: 'g'.repeat(81) }, { title: 'x', group: 1 },
    { title: 'x', level: 'debug' }, { title: 'x', sessionId: '../etc' }, { title: 'x', sessionId: 'a b' },
    { title: 'x', url: 'javascript:alert(1)' }, { title: 'x', url: 'file:///etc/passwd' }, { title: 'x', url: 'not a url' },
  ];
  for (const c of cases) assert.throws(() => parseNotify(c), (err) => err.status === 400, JSON.stringify(c));
});

test('previewText: one line without Markdown, bounded', () => {
  assert.equal(previewText('# Title\n\nsome `code` and [a link](https://x)\n```\nblock\n```'), 'Title some code and a link');
  assert.equal(previewText('a'.repeat(400)).length, 300);
});

// ---- POST /api/notify ----

test('without a token: 401, nothing added', async () => {
  const res = await post({ title: 'x' }, null);
  assert.equal(res.status, 401);
  assert.equal((await post({ title: 'x' }, 'wrong-token')).status, 401);
});

test('a body over 64 KB is refused with 413', async () => {
  const res = await post({ title: 'big', text: 'x'.repeat(70 * 1024) });
  assert.equal(res.status, 413);
});

test('invalid bodies: 400 with a reason', async () => {
  for (const body of [{ text: 'no title' }, { title: 'x', level: 'loud' }, { title: 'x', url: 'ftp://example.com' }, '{not json']) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
});

test('a valid message: 201 and it shows up in the inbox', async () => {
  const res = await post({ title: 'daily-report done', text: '**3** new entries', group: 'daily-report', level: 'info' });
  assert.equal(res.status, 201);
  const { ok, id } = await res.json();
  assert.equal(ok, true);
  const item = (await inboxItems()).find((x) => x.id === id);
  assert.ok(item, 'entry in GET /api/inbox');
  assert.equal(item.kind, 'automation');
  assert.equal(item.source, 'notify');
  assert.equal(item.group, 'daily-report');
  assert.equal(item.status, 'ok');
  assert.equal(item.read, false);
  assert.equal(item.text, '3 new entries');
});

test('the notify token may post to /api/notify, but nothing else', async () => {
  const res = await post({ title: 'via notify token', group: 'disk-alert', level: 'error' }, NOTIFY_TOKEN);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.equal((await fetch(`${srv.base}/api/inbox`, { headers: { authorization: `Bearer ${NOTIFY_TOKEN}` } })).status, 401);
  assert.equal((await fetch(`${srv.base}/api/sessions`, { headers: { authorization: `Bearer ${NOTIFY_TOKEN}` } })).status, 401);
  assert.equal((await inboxItems()).find((x) => x.id === id)?.status, 'error');
});

// ---- hermes-ui notify ----

function cli(args, { stdin = null, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'notify', ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, HERMES_UI_PORT: String(srv.port), HERMES_UI_ENV_FILE: '/nonexistent/.env', HERMES_UI_TOKEN: TOKEN, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.stdin.end(stdin ?? '');
  });
}

test('cli: text from stdin, options as flags; prints the id', async () => {
  const r = await cli(['--title', 'Disk alert', '--group', 'disk-alert', '--level', 'warn', '--url', 'https://example.com/disk'], { stdin: '# Disk\n/data at 91 %\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^notify:/);
  const item = (await inboxItems()).find((x) => x.id === r.out);
  assert.equal(item.title, 'Disk alert');
  assert.equal(item.group, 'disk-alert');
  assert.equal(item.level, 'warn');
  assert.equal(item.link, 'https://example.com/disk');
  assert.equal(item.text, 'Disk /data at 91 %');
});

test('cli: --text= form and the notify token (board token not needed)', async () => {
  const r = await cli(['--title=daily-report', '--text=all good'], { env: { HERMES_UI_TOKEN: 'not-the-token', HERMES_UI_NOTIFY_TOKEN: NOTIFY_TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.equal((await inboxItems()).find((x) => x.id === r.out)?.group, 'notify');
});

test('cli: missing title and rejected input exit non-zero', async () => {
  assert.equal((await cli([], { stdin: 'x' })).code, 2);
  const bad = await cli(['--title', 'x', '--level', 'loud']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /level/);
});
