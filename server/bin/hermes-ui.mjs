#!/usr/bin/env node
// hermes-ui CLI: `serve` runs the headless backend (API + live stream on 127.0.0.1, optional UI and
// remote access); `pair` prints a one-time pairing link + QR for a phone/tablet; `status` shows state;
// `notify` puts a message from a script into the inbox (POST /api/notify).

import QRCode from 'qrcode';
import { loadConfig } from '../src/config.mjs';

const [cmd = 'serve', ...rest] = process.argv.slice(2);

const HELP = `hermes-ui – Kanban board for Hermes Agent sessions

Usage:
  hermes-ui serve [options]   start the backend (default)
  hermes-ui pair              print a pairing link + QR code for a remote device
  hermes-ui status            show backend, Hermes, Paseo and remote status
  hermes-ui install-gateway   download + verify the iroh-gateway binary now (otherwise on the first iroh start)
  hermes-ui notify --title <t> [--group <g>] [--level info|warn|error] [--session <id>] [--url <url>] [--text <md>]
                              put a message into the inbox (text from --text or stdin, Markdown); uses
                              HERMES_UI_NOTIFY_TOKEN if set, else HERMES_UI_TOKEN
  hermes-ui help

Options (each also as env var, see README):
  --port <n>            HERMES_UI_PORT            local port (default 8787, always 127.0.0.1)
  --remote <mode>       HERMES_UI_REMOTE          off | iroh | tailscale-funnel | tailscale-serve | cloudflare
  --ui on|off           HERMES_UI_SERVE_UI              serve the bundled UI or run headless
  --ui-url <url>        HERMES_UI_URL          public URL of the static UI used in iroh pairing links
  --hermes-home <dir>   HERMES_HOME            Hermes data dir (default ~/.hermes)
  --paseo auto|off      HERMES_UI_PASEO           Paseo agent integration
  --paseo-url <ws-url>  PASEO_DAEMON_URL       Paseo daemon (default from paseo-mcp config or ws://127.0.0.1:6767/ws)
  --iroh-relay <url>    IROH_RELAY_URL         own iroh relay instead of the public n0 relays
  --data-dir <dir>      HERMES_UI_DATA_DIR        board state, devices, tunnel state
  --env-file <file>     HERMES_UI_ENV_FILE        .env file to read (default ./.env)
`;

async function api(path, init = {}, { notify = false } = {}) {
  const cfg = loadConfig(rest);
  const token = (notify && cfg.notifyToken) || cfg.token;
  const res = await fetch(`http://127.0.0.1:${cfg.port}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
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
  } catch (err) { console.error(`pair failed: ${err.message} (is the backend running with --remote?)`); process.exit(1); }
} else if (cmd === 'status') {
  try {
    const [h, r] = await Promise.all([api('/api/health'), api('/api/remote')]);
    console.log(JSON.stringify({ hermesGateway: h.gateway, remote: r.remote, devices: r.devices.map((d) => `${d.name} (${d.via}${d.irohId ? ` ${d.irohId.slice(0, 10)}…` : ''})`) }, null, 2));
  } catch (err) { console.error(`backend not reachable: ${err.message}`); process.exit(1); }
} else if (cmd === 'install-gateway') {
  try {
    const cfg = loadConfig(rest);
    const { ensureGatewayBinary } = await import('../src/iroh.mjs');
    console.log(await ensureGatewayBinary({ ...cfg.iroh, dataDir: cfg.dataDir }));
  } catch (err) { console.error(`install-gateway failed: ${err.message}`); process.exit(1); }
} else if (cmd === 'notify') {
  const opt = (name) => { const i = rest.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`)); if (i < 0) return undefined; const a = rest[i]; return a.includes('=') ? a.slice(a.indexOf('=') + 1) : rest[i + 1]; };
  let text = opt('text');
  if (text === undefined && !process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    text = Buffer.concat(chunks).toString('utf8');
  }
  const body = { title: opt('title'), text: text ?? '', group: opt('group'), level: opt('level'), sessionId: opt('session'), url: opt('url') };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  if (!body.title) { console.error('notify: --title is required'); process.exit(2); }
  try {
    const { id } = await api('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { notify: true });
    console.log(id);
  } catch (err) { console.error(`notify failed: ${err.message}`); process.exit(1); }
} else {
  console.log(HELP);
}
