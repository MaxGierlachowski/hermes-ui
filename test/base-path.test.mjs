// HERMES_UI_BASE_PATH=/hermes: agentbox's Caddy strips the prefix (handle_path /hermes/*), but everything
// the browser loads or calls must stay below /hermes/. The server injects <base href="/hermes/"> and the
// page config into index.html; the build uses relative URLs only, so the same web/dist works at /.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers/server.mjs';
import { renderIndex } from '../src/page.mjs';
import { normalizeBasePath } from '../src/config.mjs';

const SECRET = 'test-proxy-secret-0123456789abcdef';
const auth = { 'X-Agentbox-User': 'owner', 'X-Agentbox-Proxy-Secret': SECRET };
let srv;

before(async () => {
  srv = await startServer({ HERMES_UI_AUTH: 'proxy', HERMES_UI_PROXY_SECRET: SECRET, HERMES_UI_BASE_PATH: '/hermes/', HERMES_UI_PAIRING_URL: '/devices?pair=1' });
});
after(() => srv?.stop());

const pageConfig = (html) => JSON.parse(html.match(/<meta name="hermes-ui-config" content="([^"]*)">/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

test('normalizeBasePath', () => {
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('/hermes'), '/hermes');
  assert.equal(normalizeBasePath('/hermes/'), '/hermes');
  assert.equal(normalizeBasePath('hermes'), '/hermes');
  assert.equal(normalizeBasePath('/apps/hermes-ui'), '/apps/hermes-ui');
  for (const bad of ['/../etc', '/a b', '/a?b', '//evil.example', '/a/./b', '/"><script>']) assert.throws(() => normalizeBasePath(bad), /HERMES_UI_BASE_PATH/, bad);
});

test('renderIndex injects <base> and the page config once, escaped', () => {
  const html = '<!doctype html><html><head><base href="/old/"><title>x</title></head></html>';
  const out = renderIndex(html, { basePath: '/hermes', auth: 'proxy', pairingUrl: '/devices?pair=1&x="y"' });
  assert.equal(out.match(/<base /g).length, 1);
  assert.match(out, /<base href="\/hermes\/">/);
  assert.deepEqual(pageConfig(out), { base: '/hermes', auth: 'proxy', pairingUrl: '/devices?pair=1&x="y"' });
  assert.doesNotMatch(out, /x="y"/);
  // Standalone: base "/", no pairing URL leaks into token mode.
  const plain = renderIndex(html, { basePath: '', auth: 'token', pairingUrl: '/devices' });
  assert.match(plain, /<base href="\/">/);
  assert.deepEqual(pageConfig(plain), { base: '', auth: 'token', pairingUrl: null });
});

test('index.html: same document with the prefix stripped (Caddy handle_path) and kept', async () => {
  for (const p of ['/', '/hermes/', '/index.html', '/hermes/index.html', '/some/deep/route', '/hermes/some/deep/route']) {
    const res = await fetch(srv.base + p);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.match(html, /<base href="\/hermes\/">/, p);
    assert.deepEqual(pageConfig(html), { base: '/hermes', auth: 'proxy', pairingUrl: '/devices?pair=1' }, p);
    // Every URL in the build stays relative, so it resolves below /hermes/ through <base>.
    assert.doesNotMatch(html, /(src|href)="\/(?!hermes\/)/, p);
  }
});

test('/hermes without a slash redirects to /hermes/', async () => {
  const res = await fetch(`${srv.base}/hermes?compose=hi`, { redirect: 'manual' });
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), '/hermes/?compose=hi');
});

test('assets, service worker and manifest with and without the prefix', async () => {
  for (const f of ['assets/index-test.js', 'sw.js', 'manifest.webmanifest']) {
    for (const p of [`/${f}`, `/hermes/${f}`]) assert.equal((await fetch(srv.base + p)).status, 200, p);
  }
  const res = await fetch(`${srv.base}/hermes/assets/index-test.js`);
  assert.match(res.headers.get('cache-control'), /immutable/);
});

test('API and event stream answer below the prefix', async () => {
  for (const p of ['/api/sessions', '/hermes/api/sessions']) {
    const res = await fetch(srv.base + p, { headers: auth });
    assert.equal(res.status, 200, p);
    assert.ok(Array.isArray((await res.json()).sessions));
  }
  assert.equal((await fetch(`${srv.base}/hermes/api/sessions`)).status, 401);
  const ac = new AbortController();
  const res = await fetch(`${srv.base}/hermes/api/events`, { headers: auth, signal: ac.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(Buffer.from(value).toString(), /^event: gateway\ndata: \{"connected":false\}/);
  ac.abort();
});

test('standalone (no base path): served at / with <base href="/">', async () => {
  const plain = await startServer({ HERMES_UI_TOKEN: 'test-board-token-0123456789' });
  try {
    const html = await (await fetch(`${plain.base}/`)).text();
    assert.match(html, /<base href="\/">/);
    assert.deepEqual(pageConfig(html), { base: '', auth: 'token', pairingUrl: null });
    // Without a base path, /hermes/… is just an unknown client route (index.html), not the API.
    const res = await fetch(`${plain.base}/hermes/api/sessions`, { headers: { Authorization: 'Bearer test-board-token-0123456789' } });
    assert.match(res.headers.get('content-type'), /text\/html/);
  } finally { await plain.stop(); }
});

test('the real build uses only relative URLs (if built)', { skip: !fs.existsSync(path.resolve(fileURLToPath(import.meta.url), '../../web/dist/index.html')) }, () => {
  const dist = path.resolve(fileURLToPath(import.meta.url), '../../web/dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)="\//);
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
});
