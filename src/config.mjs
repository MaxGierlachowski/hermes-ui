// All configuration in one place: CLI flags > environment > .env file > defaults.
// Nothing here is specific to one machine or user; every path can be overridden.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expand = (p) => (p ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);

function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=', 2);
    flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return flags;
}

export function loadConfig(argv = []) {
  const flags = parseFlags(argv);
  const envFile = expand(flags['env-file'] || process.env.KANBAN_ENV_FILE || path.join(ROOT, '.env'));
  const fileEnv = readEnvFile(envFile);
  const get = (key, flag, def) => flags[flag] ?? process.env[key] ?? fileEnv[key] ?? def;

  let token = get('KANBAN_TOKEN', 'token', '');
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    fs.appendFileSync(envFile, `KANBAN_TOKEN=${token}\n`, { mode: 0o600 });
    console.log(`Generated KANBAN_TOKEN in ${envFile}`);
  }

  const dataDir = expand(get('KANBAN_DATA_DIR', 'data-dir', path.join(ROOT, 'data')));
  const hermesHome = expand(get('HERMES_HOME', 'hermes-home', path.join(os.homedir(), '.hermes')));
  const paseoMcpConfig = expand(get('PASEO_MCP_CONFIG', 'paseo-mcp-config', path.join(os.homedir(), '.config', 'paseo-mcp', 'config.json')));
  let paseoUrl = get('PASEO_DAEMON_URL', 'paseo-url', '');
  if (!paseoUrl) {
    try { paseoUrl = JSON.parse(fs.readFileSync(paseoMcpConfig, 'utf8')).daemonUrl || ''; } catch { /* no paseo-mcp config */ }
  }

  return {
    envFile,
    token,
    host: '127.0.0.1', // never configurable: remote access goes through a tunnel, not an open port
    port: Number(get('KANBAN_PORT', 'port', 8787)),
    dataDir,
    hermesHome,
    lang: get('KANBAN_LANG', 'lang', 'en'),
    // UI: serve the built UI from this backend ("on") or run headless ("off").
    ui: get('KANBAN_UI', 'ui', 'on') !== 'off',
    uiDir: expand(get('KANBAN_UI_DIR', 'ui-dir', path.join(ROOT, 'web', 'dist'))),
    // Public URL of the static UI (e.g. GitHub Pages) used in iroh pairing links. Empty = local UI only.
    uiUrl: (get('KANBAN_UI_URL', 'ui-url', '') || '').replace(/\/$/, ''),
    remote: get('KANBAN_REMOTE', 'remote', 'off'), // off | iroh | tailscale-funnel | tailscale-serve | cloudflare
    iroh: {
      bin: expand(get('IROH_GATEWAY_BIN', 'iroh-gateway-bin', '')),
      version: get('IROH_GATEWAY_VERSION', 'iroh-gateway-version', 'v0.6.3'),
      relayUrl: get('IROH_RELAY_URL', 'iroh-relay', ''),
      relayToken: get('IROH_RELAY_TOKEN', 'iroh-relay-token', ''),
      adminPort: Number(get('IROH_ADMIN_PORT', 'iroh-admin-port', 0)) || null,
    },
    tailscale: { authKey: get('TS_AUTHKEY', 'ts-authkey', ''), hostname: get('TS_HOSTNAME', 'ts-hostname', 'hermes-kanban') },
    paseo: {
      mode: get('KANBAN_PASEO', 'paseo', 'auto'), // auto | off
      url: paseoUrl || 'ws://127.0.0.1:6767/ws',
      opsLoopFile: expand(get('PASEO_OPS_FILE', 'paseo-ops-file', path.join(hermesHome, 'ops-loop', 'paseo.json'))),
    },
  };
}
