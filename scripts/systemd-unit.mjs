#!/usr/bin/env node
// Prints a systemd system unit for the backend (Linux). Nothing is installed:
//   node scripts/systemd-unit.mjs --user hermes --environment-file /etc/hermes-ui.env | sudo tee /etc/systemd/system/hermes-ui.service
//   sudo systemctl daemon-reload && sudo systemctl enable --now hermes-ui
//
// Options:
//   --user <name>              account the service runs as (default: the current user)
//   --group <name>             group (default: the user's primary group)
//   --environment-file <file>  EnvironmentFile= with the HERMES_UI_* settings; put secrets
//                              (HERMES_UI_PROXY_SECRET, PASEO_MCP_TOKEN, …) here, never on the command line
//   --working-dir <dir>        WorkingDirectory= (default: this checkout / unpacked release)
//   --node <path>              node binary (default: the node running this script)
//   --name <name>              service description suffix (default: hermes-ui)
//   --set KEY=VALUE            extra Environment= line (repeatable; not for secrets)
// Anything after `--` is passed to `hermes-ui serve`, e.g. `-- --port 8787`.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const opts = { set: [], serve: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opts.serve = argv.slice(i + 1); break; }
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    const v = inline ?? argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    if (k === 'set') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) throw new Error(`--set expects KEY=VALUE, not "${v}"`);
      opts.set.push(v);
    } else if (['user', 'group', 'environment-file', 'working-dir', 'node', 'name'].includes(k)) opts[k] = v;
    else throw new Error(`unknown option --${k}`);
  }
  return opts;
}

// systemd command-line quoting: % starts a specifier and $ a variable, both doubled; quote what has spaces.
const word = (s) => {
  const e = String(s).replace(/%/g, '%%').replace(/\$/g, '$$$$');
  return /[\s"'\\;]/.test(e) || e === '' ? `"${e.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : e;
};
const absolute = (p, what) => {
  if (!path.isAbsolute(p)) throw new Error(`${what} must be an absolute path: ${p}`);
  return p;
};

export function renderUnit(opts = {}) {
  const user = opts.user || os.userInfo().username;
  const workdir = absolute(opts['working-dir'] || root, '--working-dir');
  const node = absolute(opts.node || process.execPath, '--node');
  const exec = [node, path.join(workdir, 'bin', 'hermes-ui.mjs'), 'serve', ...(opts.serve || [])].map(word).join(' ');
  const lines = [
    '[Unit]',
    `Description=Hermes UI (${opts.name || 'hermes-ui'})`,
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${user}`,
    ...(opts.group ? [`Group=${opts.group}`] : []),
    `WorkingDirectory=${word(workdir)}`,
    ...(opts['environment-file'] ? [`EnvironmentFile=${absolute(opts['environment-file'], '--environment-file')}`] : []),
    'Environment=NODE_ENV=production',
    ...(opts.set || []).map((kv) => `Environment=${word(kv)}`),
    `ExecStart=${exec}`,
    'Restart=on-failure',
    'RestartSec=2',
    // The backend binds to loopback and needs read access to HERMES_HOME (state.db, gateway.sock) and
    // Paseo's temp attachment dirs, so /home and /tmp stay visible; the rest is locked down.
    'NoNewPrivileges=true',
    'ProtectSystem=full',
    'ProtectKernelTunables=true',
    'ProtectKernelModules=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    'LockPersonality=true',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(renderUnit(parseArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(`systemd-unit: ${err.message}`);
    process.exit(2);
  }
}
