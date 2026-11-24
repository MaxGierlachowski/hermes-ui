// Files in chats end to end through the real server: the thread carries confirmed file references,
// /api/sessions/:id/file serves only files that very chat mentions, with safe headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers/server.mjs';

const TOKEN = 'test-token-files';
const auth = { authorization: `Bearer ${TOKEN}` };
let srv;
let home;
const put = (rel, body) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };

test.before(async () => {
  // The server's HOME is a temp dir it creates; files go into a second one passed as the file root.
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-files-home-')));
  put('notes/plan.md', '# Plan\n\n- one\n');
  put('out/report.pdf', '%PDF-1.4\n');
  put('out/page.html', '<script>alert(1)</script>');
  put('out/other.md', 'not mentioned');
  put('project/.env', 'A=1');
  put('out/data.csv', 'a,b\n1,2\n');
  srv = await startServer({ HERMES_UI_TOKEN: TOKEN, HERMES_UI_FILE_ROOTS: home }, {
    sessions: [
      {
        id: 'files-1',
        messages: [
          { role: 'user', content: 'Write the plan' },
          { role: 'tool', content: `wrote ${home}/out/data.csv` },
          { role: 'assistant', content: `Done: \`${home}/notes/plan.md\`, see [report](${home}/out/report.pdf), ${home}/out/page.html, ${home}/project/.env and /api/sessions.\n\nMEDIA:${home}/out/data.csv` },
        ],
      },
      { id: 'files-2', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'nothing here' }] },
    ],
  });
});
test.after(async () => { await srv?.stop(); fs.rmSync(home, { recursive: true, force: true }); });

const get = (url, headers = {}) => fetch(`${srv.base}${url}`, { headers: { ...auth, ...headers } });

test('the thread lists confirmed files only (no .env, no routes); MEDIA files become file cards', async () => {
  const thread = await (await get('/api/sessions/files-1')).json();
  const reply = thread.messages.find((m) => m.role === 'assistant');
  assert.deepEqual(reply.files.map((f) => f.name), ['plan.md', 'report.pdf', 'page.html']);
  const plan = reply.files[0];
  assert.equal(plan.key, `${home}/notes/plan.md`);
  assert.equal(plan.url, `/api/sessions/files-1/file?path=${encodeURIComponent(plan.key)}`);
  assert.equal(plan.preview, true);
  assert.equal(plan.mime, 'text/markdown');
  const card = reply.attachments.find((a) => a.kind === 'file');
  assert.equal(card.name, 'data.csv');
  assert.equal(card.file.preview, true);
  const tool = thread.messages.find((m) => m.role === 'tool');
  assert.deepEqual(tool.files.map((f) => f.name), ['data.csv']);
});

test('text preview: JSON with the content', async () => {
  const res = await get(`/api/sessions/files-1/file/text?path=${encodeURIComponent(`${home}/notes/plan.md`)}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: '# Plan\n\n- one\n', truncated: false, size: 14 });
  // HTML is shown as source, never served as a page.
  const html = await get(`/api/sessions/files-1/file?path=${encodeURIComponent(`${home}/out/page.html`)}`);
  assert.equal(html.status, 415);
  assert.equal((await (await get(`/api/sessions/files-1/file/text?path=${encodeURIComponent(`${home}/out/page.html`)}`)).json()).text, '<script>alert(1)</script>');
});

test('inline PDF and download with safe headers', async () => {
  const key = encodeURIComponent(`${home}/out/report.pdf`);
  const inline = await get(`/api/sessions/files-1/file?path=${key}`);
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get('content-type'), 'application/pdf');
  assert.equal(inline.headers.get('x-content-type-options'), 'nosniff');
  assert.match(inline.headers.get('content-security-policy'), /default-src 'none'/);
  const dl = await get(`/api/sessions/files-1/file?path=${key}&download=1`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.equal(dl.headers.get('content-disposition'), `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  assert.match(dl.headers.get('content-security-policy'), /sandbox/);
  assert.equal(await dl.text(), '%PDF-1.4\n');
  const part = await get(`/api/sessions/files-1/file?path=${key}&download=1`, { Range: 'bytes=0-3' });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), '%PDF');
});

test('refused: files the chat does not mention, other chats, the denylist, no auth', async () => {
  const q = (p) => encodeURIComponent(`${home}/${p}`);
  assert.equal((await get(`/api/sessions/files-1/file?path=${q('out/other.md')}&download=1`)).status, 404);
  assert.equal((await get(`/api/sessions/files-2/file?path=${q('notes/plan.md')}&download=1`)).status, 404);
  assert.equal((await get(`/api/sessions/files-1/file?path=${q('project/.env')}&download=1`)).status, 404);
  assert.equal((await get(`/api/sessions/files-1/file?path=${q('notes/../project/.env')}&download=1`)).status, 404);
  assert.equal((await get(`/api/sessions/nope/file?path=${q('notes/plan.md')}`)).status, 404);
  assert.equal((await fetch(`${srv.base}/api/sessions/files-1/file?path=${q('notes/plan.md')}&download=1`)).status, 401);
});
