// HERMES_UI_AUTH=proxy: behind agentbox's Caddy. A request is authorized iff X-Agentbox-Proxy-Secret
// equals HERMES_UI_PROXY_SECRET and X-Agentbox-User is non-empty; token, device cookie, pairing and
// the built-in iroh gateway are off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, startupError } from './helpers/server.mjs';

const SECRET = 'test-proxy-secret-0123456789abcdef';
const TOKEN = 'test-board-token-0123456789';
const ok = { 'X-Agentbox-User': 'owner', 'X-Agentbox-Proxy-Secret': SECRET };
let srv;

before(async () => {
  srv = await startServer({
    HERMES_UI_AUTH: 'proxy',
    HERMES_UI_PROXY_SECRET: SECRET,
    HERMES_UI_TOKEN: TOKEN,
    HERMES_UI_PAIRING_URL: '/devices?pair=1',
    HERMES_UI_REMOTE: 'iroh', // must be ignored in proxy mode
  });
});
after(() => srv?.stop());

const get = (p, headers = {}, init = {}) => fetch(srv.base + p, { headers, ...init });

test('secret + user header: authorized', async () => {
  const res = await get('/api/sessions', ok);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).sessions, []);
});

test('missing or wrong headers: 401', async () => {
  const cases = [
    {},
    { 'X-Agentbox-User': 'owner' },
    { 'X-Agentbox-Proxy-Secret': SECRET },
    { 'X-Agentbox-User': '', 'X-Agentbox-Proxy-Secret': SECRET },
    { 'X-Agentbox-User': '   ', 'X-Agentbox-Proxy-Secret': SECRET },
    { 'X-Agentbox-User': 'owner', 'X-Agentbox-Proxy-Secret': SECRET.replace(/.$/, 'X') }, // same length
    { 'X-Agentbox-User': 'owner', 'X-Agentbox-Proxy-Secret': 'short' },
    { 'X-Agentbox-User': 'owner', 'X-Agentbox-Proxy-Secret': `${SECRET}x` },
  ];
  for (const headers of cases) {
    const res = await get('/api/sessions', headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
  }
});

test('the event stream needs the proxy headers too', async () => {
  assert.equal((await get('/api/events')).status, 401);
  const ac = new AbortController();
  const res = await get('/api/events', ok, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  ac.abort();
});

test('board token and device cookies are not accepted in proxy mode', async () => {
  assert.equal((await get('/api/sessions', { Authorization: `Bearer ${TOKEN}` })).status, 401);
  assert.equal((await get(`/api/sessions?token=${TOKEN}`)).status, 401);
  assert.equal((await get('/api/sessions', { Cookie: 'hk_device=abc.def' })).status, 401);
});

test('login, pairing and device management are disabled', async () => {
  const login = await get('/api/login', { 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify({ token: TOKEN }) });
  assert.equal(login.status, 403);
  assert.equal(login.headers.get('set-cookie'), null);
  assert.equal((await get('/api/pair/redeem', {}, { method: 'POST', body: '{"code":"x"}' })).status, 403);
  assert.equal((await get('/api/pair', ok, { method: 'POST' })).status, 403);
  assert.equal((await get('/api/devices/abc', ok, { method: 'DELETE' })).status, 403);
});

test('remote state: built-in gateway off, pairing delegated to HERMES_UI_PAIRING_URL', async () => {
  const r = await (await get('/api/remote', ok)).json();
  assert.equal(r.remote.mode, 'off');
  assert.equal(r.remote.auth, 'proxy');
  assert.equal(r.remote.pairingUrl, '/devices?pair=1');
  assert.deepEqual(r.devices, []);
  assert.doesNotMatch(srv.log(), /iroh-gateway|downloading/);
});

test('health: open on direct loopback, behind the proxy only with its headers', async () => {
  const direct = await get('/api/health');
  assert.equal(direct.status, 200);
  assert.deepEqual(Object.keys(await direct.json()).sort(), ['gateway', 'ok']);
  assert.equal((await get('/api/health', { 'X-Forwarded-For': '10.0.0.5' })).status, 401);
  assert.equal((await get('/api/health', { 'X-Forwarded-For': '10.0.0.5', ...ok })).status, 200);
});

test('proxy mode refuses to start without a secret', async () => {
  const out = await startupError({ HERMES_UI_AUTH: 'proxy' });
  assert.match(out, /HERMES_UI_PROXY_SECRET/);
  const short = await startupError({ HERMES_UI_AUTH: 'proxy', HERMES_UI_PROXY_SECRET: 'short' });
  assert.match(short, /HERMES_UI_PROXY_SECRET/);
});

test('token mode is unchanged and ignores proxy headers', async () => {
  const tok = await startServer({ HERMES_UI_TOKEN: TOKEN, HERMES_UI_PROXY_SECRET: SECRET });
  try {
    assert.equal((await fetch(`${tok.base}/api/sessions`, { headers: ok })).status, 401);
    assert.equal((await fetch(`${tok.base}/api/sessions`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 200);
    const login = await fetch(`${tok.base}/api/login`, { method: 'POST', body: JSON.stringify({ token: TOKEN }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /hk_device=/);
  } finally { await tok.stop(); }
});

test('removed remote modes are rejected', async () => {
  for (const mode of ['tailscale-funnel', 'tailscale-serve', 'cloudflare']) {
    assert.match(await startupError({ HERMES_UI_REMOTE: mode, HERMES_UI_TOKEN: TOKEN }), /HERMES_UI_REMOTE must be off or iroh/);
  }
});
