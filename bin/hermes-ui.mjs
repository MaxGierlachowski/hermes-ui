#!/usr/bin/env node
// hermes-ui CLI: `serve` runs the headless backend (API + live stream on 127.0.0.1, optional UI and
// remote access); `pair` prints a one-time pairing link + QR for a phone/tablet; `status` shows state.

import QRCode from 'qrcode';
import { loadConfig } from '../src/config.mjs';

const [cmd = 'serve', ...rest] = process.argv.slice(2);

const HELP = `hermes-ui – Kanban board for Hermes Agent sessions

Usage:
  hermes-ui serve [options]   start the backend (default)
  hermes-ui pair              print a pairing link + QR code for a remote device
  hermes-ui status            show backend, Hermes, Paseo and remote status
  hermes-ui help

Options (each also as env var, see README):
  --port <n>            HERMES_UI_PORT         local port (default 8787)
  --host <addr>         HERMES_UI_HOST         loopback address to bind (127.0.0.1, ::1 or localhost)
  --remote off|iroh     HERMES_UI_REMOTE       built-in remote access (iroh gateway)
  --auth token|proxy    HERMES_UI_AUTH         token (standalone) or proxy (behind a reverse proxy;
                                               needs HERMES_UI_PROXY_SECRET in the environment)
  --base-path <path>    HERMES_UI_BASE_PATH    URL prefix the browser sees, e.g. /hermes
  --pairing-url <url>   HERMES_UI_PAIRING_URL  proxy mode: the proxy's device pairing page
  --ui on|off           HERMES_UI_SERVE_UI     serve the bundled UI or run headless
  --ui-url <url>        HERMES_UI_URL          public URL of the static UI used in iroh pairing links
  --hermes-home <dir>   HERMES_HOME            Hermes data dir (default ~/.hermes)
  --paseo auto|off      HERMES_UI_PASEO        Paseo agent integration
  --paseo-url <ws-url>  PASEO_DAEMON_URL       Paseo daemon (default from paseo-mcp config or ws://127.0.0.1:6767/ws)
  --iroh-relay <url>    IROH_RELAY_URL         own iroh relay instead of the public n0 relays
  --data-dir <dir>      HERMES_UI_DATA_DIR     board state, devices, push keys
  --env-file <file>     HERMES_UI_ENV_FILE     .env file to read (default ./.env)
`;

async function api(path, init = {}) {
  const cfg = loadConfig(rest);
  if (cfg.auth === 'proxy' && path !== '/api/health') throw new Error('not available with HERMES_UI_AUTH=proxy (devices are paired by the proxy)');
  const host = cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host;
  const res = await fetch(`http://${host}:${cfg.port}${path}`, { ...init, headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

if (cmd === 'serve') {
  process.argv = [process.argv[0], process.argv[1], ...rest];
  await import('../server.mjs');
} else if (cmd === 'pair') {
  try {
    const { link, expiresAt } = await api('/api/pair', { method: 'POST' });
    console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
    console.log(link);
    console.log(`\nOne-time code, valid until ${new Date(expiresAt).toLocaleTimeString()}.`);
  } catch (err) { console.error(`pair failed: ${err.message} (is the backend running with --remote iroh?)`); process.exit(1); }
} else if (cmd === 'status') {
  try {
    if (loadConfig(rest).auth === 'proxy') { console.log(JSON.stringify({ auth: 'proxy', hermesGateway: (await api('/api/health')).gateway }, null, 2)); process.exit(0); }
    const [h, r] = await Promise.all([api('/api/health'), api('/api/remote')]);
    console.log(JSON.stringify({ hermesGateway: h.gateway, remote: r.remote, devices: r.devices.map((d) => `${d.name} (${d.via}${d.irohId ? ` ${d.irohId.slice(0, 10)}…` : ''})`) }, null, 2));
  } catch (err) { console.error(`backend not reachable: ${err.message}`); process.exit(1); }
} else {
  console.log(HELP);
}
