import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Board } from '../src/board.mjs';
import { Labels, labelRoutes, LABEL_COLORS } from '../src/labels.mjs';

// The label routes mounted on a real HTTP server with a real Board in a temp data dir, like server.mjs
// does it; cards are a fixed set of ids, broadcasts are recorded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-labels-'));
const CARDS = new Set(['s-1', 's-2', 's-3', 'draft:d-1']);
const events = [];
let board, labels, server, base;

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
const cardById = (id) => (CARDS.has(id) ? { id, labels: labels.forCard(id) } : null);

async function api(method, p, body) {
  const res = await fetch(`${base}${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  board = new Board(dir);
  labels = new Labels(board);
  const handle = labelRoutes(labels, { readJson, send, broadcast: (event, data) => events.push({ event, data }), cardById });
  server = http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    try {
      if (await handle(req, res, p)) return;
      send(res, 404, { error: 'not found' });
    } catch (err) { send(res, 500, { error: err.message }); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let mouve, personal;

test('create labels: name trimmed, color validated, preset color when none given, names unique', async () => {
  assert.deepEqual((await api('GET', '/api/labels')).body, { labels: [] });
  let r = await api('POST', '/api/labels', { name: '  MOUVE  ', color: '#A855F7' });
  assert.equal(r.status, 200);
  mouve = r.body.label;
  assert.equal(mouve.name, 'MOUVE');
  assert.equal(mouve.color, '#a855f7');
  r = await api('POST', '/api/labels', { name: 'personal' });
  personal = r.body.label;
  assert.ok(LABEL_COLORS.includes(personal.color));
  assert.equal(r.body.labels.length, 2);
  assert.equal((await api('POST', '/api/labels', { name: 'mouve' })).status, 409, 'case-insensitive duplicate');
  assert.equal((await api('POST', '/api/labels', { name: '   ' })).status, 400);
  assert.equal((await api('POST', '/api/labels', { name: 'x', color: 'red' })).status, 400);
  assert.deepEqual(events.at(-1).event, 'labels');
});

test('assign zero, one or several labels to cards; unknown cards and labels are refused', async () => {
  let r = await api('PUT', '/api/sessions/s-1/labels', { labels: [personal.id, mouve.id, mouve.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.labels, [mouve.id, personal.id], 'deduplicated, in the order of the label list');
  assert.deepEqual(r.body.session, { id: 's-1', labels: [mouve.id, personal.id] });
  assert.deepEqual(events.at(-1), { event: 'session', data: { id: 's-1', labels: [mouve.id, personal.id] } });
  r = await api('PUT', '/api/sessions/s-2/labels', { labels: [mouve.id] });
  assert.deepEqual(r.body.labels, [mouve.id]);
  assert.equal((await api('PUT', '/api/sessions/nope/labels', { labels: [mouve.id] })).status, 404);
  assert.equal((await api('PUT', '/api/sessions/s-3/labels', { labels: ['bogus'] })).status, 400);
  assert.equal((await api('PUT', '/api/sessions/s-3/labels', { labels: 'x' })).status, 400);
  assert.deepEqual(labels.forCard('s-3'), [], 'an unlabeled card stays unlabeled');
  r = await api('PUT', '/api/sessions/s-2/labels', { labels: [] });
  assert.deepEqual(r.body.labels, []);
  assert.equal(board.data.cardLabels['s-2'], undefined, 'clearing leaves no empty entry behind');
  await api('PUT', '/api/sessions/s-2/labels', { labels: [mouve.id] });
});

test('rename and recolor', async () => {
  let r = await api('PATCH', `/api/labels/${mouve.id}`, { name: 'Mouve', color: '#3b82f6' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.label, { id: mouve.id, name: 'Mouve', color: '#3b82f6' });
  assert.equal((await api('PATCH', `/api/labels/${mouve.id}`, { name: 'Personal' })).status, 409);
  assert.equal((await api('PATCH', `/api/labels/${mouve.id}`, { color: '#zzz' })).status, 400);
  assert.equal((await api('PATCH', '/api/labels/bogus', { name: 'x' })).status, 404);
});

test('labels and assignments survive a restart (data/board.json)', () => {
  const again = new Labels(new Board(dir));
  assert.deepEqual(again.list().map((l) => l.name), ['Mouve', 'personal']);
  assert.deepEqual(again.forCard('s-1'), [mouve.id, personal.id]);
  assert.deepEqual(again.forCard('s-2'), [mouve.id]);
});

test('a started draft takes its labels along, a discarded one leaves nothing behind', () => {
  labels.setCard('draft:d-1', [personal.id]);
  labels.move('draft:d-1', 's-new');
  assert.deepEqual(labels.forCard('s-new'), [personal.id]);
  assert.deepEqual(labels.forCard('draft:d-1'), []);
  labels.forget('s-new');
  assert.equal(board.data.cardLabels['s-new'], undefined);
});

test('deleting a label removes it from every card and pushes those cards', async () => {
  events.length = 0;
  const r = await api('DELETE', `/api/labels/${mouve.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cards.sort(), ['s-1', 's-2']);
  assert.deepEqual(r.body.labels.map((l) => l.id), [personal.id]);
  assert.deepEqual(labels.forCard('s-1'), [personal.id]);
  assert.deepEqual(labels.forCard('s-2'), []);
  assert.equal(board.data.cardLabels['s-2'], undefined, 'no orphan ids left');
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'))).includes(mouve.id), 'gone from disk too');
  assert.deepEqual(events.map((e) => e.event).sort(), ['labels', 'session', 'session']);
  assert.equal((await api('DELETE', `/api/labels/${mouve.id}`)).status, 404);
});

test('ids of a label that vanished from the list never reach a card', () => {
  board.data.cardLabels['s-3'] = ['ghost', personal.id];
  assert.deepEqual(labels.forCard('s-3'), [personal.id]);
});
