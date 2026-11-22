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

// Variables are named HERMES_UI_*; the older KANBAN_* names still work as aliases.
const ALIASES = {
  HERMES_UI_ENV_FILE: 'KANBAN_ENV_FILE',
  HERMES_UI_TOKEN: 'KANBAN_TOKEN',
  HERMES_UI_PORT: 'KANBAN_PORT',
  HERMES_UI_DATA_DIR: 'KANBAN_DATA_DIR',
  HERMES_UI_LANG: 'KANBAN_LANG',
  HERMES_UI_SERVE_UI: 'KANBAN_UI',
  HERMES_UI_DIR: 'KANBAN_UI_DIR',
  HERMES_UI_URL: 'KANBAN_UI_URL',
  HERMES_UI_REMOTE: 'KANBAN_REMOTE',
  HERMES_UI_PASEO: 'KANBAN_PASEO',
};

/** '/hermes/' → '/hermes', '/' or '' → ''. Only plain path characters, no '..'. */
export function normalizeBasePath(raw) {
  let p = String(raw || '').trim();
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(p) || p.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error(`HERMES_UI_BASE_PATH must be a URL path like /hermes, not "${raw}"`);
  }
  return p;
}

export function loadConfig(argv = []) {
  const flags = parseFlags(argv);
  const fromEnv = (src, key) => src[key] ?? (ALIASES[key] ? src[ALIASES[key]] : undefined);
  const envFile = expand(flags['env-file'] || fromEnv(process.env, 'HERMES_UI_ENV_FILE') || path.join(ROOT, '.env'));
  const fileEnv = readEnvFile(envFile);
  const get = (key, flag, def) => flags[flag] ?? fromEnv(process.env, key) ?? fromEnv(fileEnv, key) ?? def;

  // Auth: "token" (standalone: board token, device cookies, pairing) or "proxy" (behind a reverse proxy
  // such as agentbox's Caddy, which authenticates the user and adds X-Agentbox-User + the shared secret).
  const auth = get('HERMES_UI_AUTH', 'auth', 'token');
  if (!['token', 'proxy'].includes(auth)) throw new Error(`HERMES_UI_AUTH must be token or proxy, not "${auth}"`);
  // The secret is read from the environment or the env file only, never from a command-line flag.
  const proxySecret = fromEnv(process.env, 'HERMES_UI_PROXY_SECRET') ?? fromEnv(fileEnv, 'HERMES_UI_PROXY_SECRET') ?? '';
  if (auth === 'proxy' && proxySecret.length < 16) throw new Error('HERMES_UI_AUTH=proxy needs HERMES_UI_PROXY_SECRET (at least 16 characters)');

  let remote = get('HERMES_UI_REMOTE', 'remote', 'off');
  if (!['off', 'iroh'].includes(remote)) throw new Error(`HERMES_UI_REMOTE must be off or iroh, not "${remote}"`);
  if (auth === 'proxy' && remote !== 'off') {
    // Remote access belongs to the proxy in front of us; the built-in gateway would bypass it.
    console.warn('HERMES_UI_AUTH=proxy: ignoring HERMES_UI_REMOTE=iroh, the built-in iroh gateway stays off');
    remote = 'off';
  }

  const host = get('HERMES_UI_HOST', 'host', '127.0.0.1');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error(`HERMES_UI_HOST must be a loopback address (127.0.0.1, ::1 or localhost), not "${host}"`);

  // In proxy mode there is no token login, so no token is generated (and nothing is written to the env file).
  let token = auth === 'proxy' ? '' : get('HERMES_UI_TOKEN', 'token', '');
  if (!token && auth !== 'proxy') {
    token = crypto.randomBytes(24).toString('base64url');
    fs.appendFileSync(envFile, `HERMES_UI_TOKEN=${token}\n`, { mode: 0o600 });
    console.log(`Generated HERMES_UI_TOKEN in ${envFile}`);
  }

  const dataDir = expand(get('HERMES_UI_DATA_DIR', 'data-dir', path.join(ROOT, 'data')));
  const hermesHome = expand(get('HERMES_HOME', 'hermes-home', path.join(os.homedir(), '.hermes')));
  const paseoMcpConfig = expand(get('PASEO_MCP_CONFIG', 'paseo-mcp-config', path.join(os.homedir(), '.config', 'paseo-mcp', 'config.json')));
  let paseoUrl = get('PASEO_DAEMON_URL', 'paseo-url', '');
  if (!paseoUrl) {
    try { paseoUrl = JSON.parse(fs.readFileSync(paseoMcpConfig, 'utf8')).daemonUrl || ''; } catch { /* no paseo-mcp config */ }
  }

  return {
    envFile,
    token,
    auth,
    proxySecret,
    // Loopback only: remote access goes through the iroh gateway or a reverse proxy, never an open port.
    host,
    // URL prefix the browser sees (e.g. /hermes behind a proxy that strips it); '' = served at the root.
    basePath: normalizeBasePath(get('HERMES_UI_BASE_PATH', 'base-path', '')),
    // Proxy mode: where the "Pair device" button sends the user (the proxy's own device pairing page).
    pairingUrl: get('HERMES_UI_PAIRING_URL', 'pairing-url', ''),
    port: Number(get('HERMES_UI_PORT', 'port', 8787)),
    dataDir,
    hermesHome,
    lang: get('HERMES_UI_LANG', 'lang', 'en'),
    // Extra directories whose images transcripts may show (path-delimiter separated, e.g. "~/Pictures:~/notes").
    // Always allowed: Hermes' image cache, the Paseo home and Paseo's attachment temp dirs.
    imageRoots: (get('HERMES_UI_IMAGE_ROOTS', 'image-roots', '') || '').split(path.delimiter).map((x) => expand(x.trim())).filter(Boolean),
    paseoHome: expand(get('PASEO_HOME', 'paseo-home', path.join(os.homedir(), '.paseo'))),
    // UI: serve the built UI from this backend ("on") or run headless ("off").
    ui: get('HERMES_UI_SERVE_UI', 'ui', 'on') !== 'off',
    uiDir: expand(get('HERMES_UI_DIR', 'ui-dir', path.join(ROOT, 'web', 'dist'))),
    // Public URL of the static UI (e.g. GitHub Pages) used in iroh pairing links. Empty = local UI only.
    uiUrl: (get('HERMES_UI_URL', 'ui-url', '') || '').replace(/\/$/, ''),
    remote, // off | iroh
    iroh: {
      bin: expand(get('IROH_GATEWAY_BIN', 'iroh-gateway-bin', '')),
      version: get('IROH_GATEWAY_VERSION', 'iroh-gateway-version', 'v0.6.4'),
      relayUrl: get('IROH_RELAY_URL', 'iroh-relay', ''),
      relayToken: get('IROH_RELAY_TOKEN', 'iroh-relay-token', ''),
      adminPort: Number(get('IROH_ADMIN_PORT', 'iroh-admin-port', 0)) || null,
    },
    // Web Push: VAPID subject (mailto: or https: URL; defaults to the UI URL). Push itself needs no config.
    push: {
      enabled: get('HERMES_UI_PUSH', 'push', 'on') !== 'off',
      subject: get('HERMES_UI_PUSH_SUBJECT', 'push-subject', ''),
      // Native app push (Android, FCM): path to the Firebase service-account JSON. Empty = off.
      fcmServiceAccount: expand(get('HERMES_UI_FCM_SERVICE_ACCOUNT', 'fcm-service-account', '')),
    },
    inbox: {
      maxDays: Number(get('HERMES_UI_INBOX_DAYS', 'inbox-days', 30)),
      maxItems: Number(get('HERMES_UI_INBOX_MAX', 'inbox-max', 1000)),
    },
    paseo: {
      mode: get('HERMES_UI_PASEO', 'paseo', 'auto'), // auto | off
      source: get('HERMES_UI_PASEO_SOURCE', 'paseo-source', 'auto'), // auto | mcp | daemon
      mcp: {
        command: get('PASEO_MCP_COMMAND', 'paseo-mcp-command', ''),
        url: get('PASEO_MCP_URL', 'paseo-mcp-url', ''),
        token: get('PASEO_MCP_TOKEN', 'paseo-mcp-token', ''),
        // HTTP only: a token with write scope for answering permissions from the inbox (stdio needs none).
        writeToken: get('PASEO_MCP_WRITE_TOKEN', 'paseo-mcp-write-token', ''),
      },
      // Answer Paseo permission requests from the inbox via paseo-mcp's paseo_respond_permission.
      respond: get('HERMES_UI_PASEO_RESPOND', 'paseo-respond', 'on') !== 'off',
      url: paseoUrl || 'ws://127.0.0.1:6767/ws',
      opsLoopFile: expand(get('PASEO_OPS_FILE', 'paseo-ops-file', path.join(hermesHome, 'ops-loop', 'paseo.json'))),
    },
  };
}
