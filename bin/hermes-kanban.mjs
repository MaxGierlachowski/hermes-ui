#!/usr/bin/env node
// hermes-kanban CLI: `serve` runs the headless backend (API + live stream on 127.0.0.1, optional UI and
// remote access); `pair` prints a one-time pairing link + QR for a phone/tablet; `status` shows state.

import QRCode from 'qrcode';
import { loadConfig } from '../src/config.mjs';

const [cmd = 'serve', ...rest] = process.argv.slice(2);

const HELP = `hermes-kanban – Kanban board for Hermes Agent sessions

Usage:
  hermes-kanban serve [options]   start the backend (default)
  hermes-kanban pair              print a pairing link + QR code for a remote device
  hermes-kanban status            show backend, Hermes, Paseo and remote status
  hermes-kanban help

Options (each also as env var, see README):
  --port <n>            KANBAN_PORT            local port (default 8787, always 127.0.0.1)
  --remote <mode>       KANBAN_REMOTE          off | iroh | tailscale-funnel | tailscale-serve | cloudflare
  --ui on|off           KANBAN_UI              serve the bundled UI or run headless
  --ui-url <url>        KANBAN_UI_URL          public URL of the static UI used in iroh pairing links
  --hermes-home <dir>   HERMES_HOME            Hermes data dir (default ~/.hermes)
  --paseo auto|off      KANBAN_PASEO           Paseo agent integration
  --paseo-url <ws-url>  PASEO_DAEMON_URL       Paseo daemon (default from paseo-mcp config or ws://127.0.0.1:6767/ws)
  --iroh-relay <url>    IROH_RELAY_URL         own iroh relay instead of the public n0 relays
  --data-dir <dir>      KANBAN_DATA_DIR        board state, devices, tunnel state
  --env-file <file>     KANBAN_ENV_FILE        .env file to read (default ./.env)
`;

async function api(path, init = {}) {
  const cfg = loadConfig(rest);
  const res = await fetch(`http://127.0.0.1:${cfg.port}${path}`, { ...init, headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers || {}) } });
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
} else {
  console.log(HELP);
}
