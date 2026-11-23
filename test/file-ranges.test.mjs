// Range requests for attachments: Safari/iOS only play <video> from 206 responses, and seeking needs
// them everywhere. sendFile() (src/local-files.mjs) unit-tested over a plain HTTP server, then a MEDIA
// video end to end through the real server (/api/sessions → attachment → /api/hermes-file).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseRange, real, sendFile } from '../src/local-files.mjs';
import { startServer } from './helpers/server.mjs';

const dir = real(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-range-')));
const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
const clip = path.join(dir, 'clip one.mp4');
fs.writeFileSync(clip, body);
const st = fs.statSync(clip);
const file = { file: clip, type: 'video/mp4', size: st.size, mtimeMs: st.mtimeMs };

let plain;
let srv;
const SECRET = 'test-proxy-secret-0123456789abcdef';
const auth = { 'X-Agentbox-User': 'owner', 'X-Agentbox-Proxy-Secret': SECRET };

before(async () => {
  plain = http.createServer((req, res) => sendFile(req, res, file, { 'X-Extra': '1' }));
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  srv = await startServer({ HERMES_UI_AUTH: 'proxy', HERMES_UI_PROXY_SECRET: SECRET, HERMES_UI_BASE_PATH: '/hermes/' }, {
    sessions: [{ id: 'video-1', messages: [
      { role: 'user', content: 'Zeig mir das Setup-Video' },
      { role: 'assistant', content: `Hier ist es:\n\nMEDIA:${clip}` },
    ] }],
  });
});
after(async () => {
  plain?.close();
  await srv?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (headers = {}, method = 'GET') => fetch(`http://127.0.0.1:${plain.address().port}/`, { method, headers });
const bytes = async (res) => Buffer.from(await res.arrayBuffer());

test('parseRange', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
  for (const h of [undefined, '', 'bytes=', 'bytes=-', 'items=0-1', 'bytes=5-1', 'bytes=0-1,5-9', 'bytes=a-b']) assert.equal(parseRange(h, 100), null, h);
});

test('no Range: 200 with the whole file and Accept-Ranges', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-length'), '1000');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('x-extra'), '1');
  assert.deepEqual(await bytes(res), body);
});

test('one range: 206 with Content-Range and exactly those bytes', async () => {
  for (const [range, start, end] of [['bytes=0-1', 0, 1], ['bytes=100-199', 100, 199], ['bytes=900-', 900, 999], ['bytes=-24', 976, 999]]) {
    const res = await get({ Range: range });
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/1000`);
    assert.equal(res.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(await bytes(res), body.subarray(start, end + 1));
  }
});

test('unsatisfiable range: 416 with the size', async () => {
  const res = await get({ Range: 'bytes=1000-' });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */1000');
});

test('several ranges or a stale If-Range: the whole file', async () => {
  assert.equal((await get({ Range: 'bytes=0-1,5-9' })).status, 200);
  const etag = (await get({}, 'HEAD')).headers.get('etag');
  assert.equal((await get({ Range: 'bytes=0-1', 'If-Range': '"stale"' })).status, 200);
  assert.equal((await get({ Range: 'bytes=0-1', 'If-Range': etag })).status, 206);
});

test('HEAD: headers only', async () => {
  const res = await get({ Range: 'bytes=0-9' }, 'HEAD');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-length'), '10');
  assert.equal((await bytes(res)).length, 0);
});

test('a MEDIA video becomes a video attachment served with ranges below the base path', async () => {
  const thread = await (await fetch(`${srv.base}/hermes/api/sessions/video-1`, { headers: auth })).json();
  const reply = thread.messages.find((m) => m.role === 'assistant');
  assert.equal(reply.text, 'Hier ist es:');
  assert.deepEqual(reply.attachments, [{ kind: 'video', url: `/api/hermes-file?path=${encodeURIComponent(clip)}`, name: 'clip one.mp4' }]);

  const url = `${srv.base}/hermes${reply.attachments[0].url}`;
  const full = await fetch(url, { headers: auth });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  // Playable when opened directly, still no scripts (see server.mjs).
  assert.equal(full.headers.get('content-security-policy'), "default-src 'none'; media-src 'self'");
  assert.deepEqual(await bytes(full), body);

  const part = await fetch(url, { headers: { ...auth, Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual(await bytes(part), body.subarray(10, 20));

  // Only the attached file: its neighbour stays unreadable, and nothing without auth.
  const other = path.join(dir, 'other.mp4');
  fs.writeFileSync(other, 'x');
  assert.equal((await fetch(`${srv.base}/hermes/api/hermes-file?path=${encodeURIComponent(other)}`, { headers: auth })).status, 404);
  assert.equal((await fetch(url)).status, 401);
});
