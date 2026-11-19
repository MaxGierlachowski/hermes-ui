// iroh remote access: runs iroh-gateway (https://github.com/irohkit/iroh-bridge, MIT) as a child
// process in front of the local API. Browsers reach it with iroh-fetch (WASM) through an iroh relay,
// end-to-end encrypted, with no open port. The gateway forwards only /api and adds X-Iroh-Remote-Id,
// the cryptographically verified endpoint id of the calling device.
//
// Access control happens twice: the gateway's IROH_ALLOW_CLIENTS (hot-reloaded via SIGHUP from a
// config file) only admits paired devices, and the server checks X-Iroh-Remote-Id again per request.
// While a pairing code is open the gateway admits everyone, but the server then only accepts the
// pairing call from unknown devices.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

const TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
};

// Downloads the release binary for this platform once and verifies its published SHA-256.
export async function ensureGatewayBinary({ bin, version, dataDir }) {
  if (bin) {
    if (!fs.existsSync(bin)) throw new Error(`IROH_GATEWAY_BIN not found: ${bin}`);
    return bin;
  }
  const onPath = (() => { try { return execFileSync('which', ['iroh-gateway'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
  if (onPath) return onPath;
  const target = TARGETS[`${os.platform()}-${os.arch()}`];
  if (!target) throw new Error(`no iroh-gateway build for ${os.platform()}-${os.arch()}; set IROH_GATEWAY_BIN`);
  const dir = path.join(dataDir, 'bin', `iroh-gateway-${version}`);
  const file = path.join(dir, 'iroh-gateway');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(dir, { recursive: true });
  const name = `iroh-gateway-${version}-${target}.tar.gz`;
  const base = `https://github.com/irohkit/iroh-bridge/releases/download/${version}`;
  console.log(`downloading ${name} …`);
  const [tar, sum] = await Promise.all([fetch(`${base}/${name}`), fetch(`${base}/${name}.sha256`)]);
  if (!tar.ok || !sum.ok) throw new Error(`download failed: ${tar.status}/${sum.status}`);
  const buf = Buffer.from(await tar.arrayBuffer());
  const want = (await sum.text()).trim().split(/\s+/)[0];
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (want !== got) throw new Error(`iroh-gateway checksum mismatch (${got} != ${want})`);
  const tgz = path.join(dir, name);
  fs.writeFileSync(tgz, buf);
  execFileSync('tar', ['xzf', tgz, '-C', dir]);
  const found = execFileSync('find', [dir, '-name', 'iroh-gateway', '-type', 'f'], { encoding: 'utf8' }).trim().split('\n')[0];
  fs.renameSync(found, file);
  fs.chmodSync(file, 0o755);
  fs.rmSync(tgz);
  return file;
}

export class IrohGateway extends EventEmitter {
  constructor({ port, dataDir, iroh }) {
    super();
    this.port = port;
    this.dir = path.join(dataDir, 'iroh');
    this.opts = iroh;
    this.configFile = path.join(this.dir, 'gateway.env');
    this.allowed = [];
    this.open = false; // pairing window
    this.state = { mode: 'iroh', status: 'starting', endpointId: null, relayUrl: null, url: null, error: null };
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  // Writes the hot-reloadable part of the gateway config and tells the gateway to reload it.
  writeAccess() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const lines = [
      `BACKEND_URL=http://127.0.0.1:${this.port}`,
      // No paired device and no pairing window: refuse every path. Empty IROH_ALLOW_CLIENTS = everyone.
      `IROH_ALLOW_CLIENTS=${this.open ? '' : this.allowed.join(',')}`,
      `IROH_ALLOW_PATHS=${this.open || this.allowed.length ? '/api' : '/__closed__'}`,
      'IROH_RATE_LIMIT=30',
      'IROH_RATE_BURST=120',
    ];
    const text = `${lines.join('\n')}\n`;
    if (text === this.lastWritten) return;
    this.lastWritten = text;
    fs.writeFileSync(this.configFile, text, { mode: 0o600 });
    // One reload per burst of changes: two SIGHUPs in quick succession can leave the gateway on the first.
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => { if (this.child && !this.child.killed) this.child.kill('SIGHUP'); }, 300);
  }

  /** Paired device ids + whether a pairing code is open, applied in one config write. */
  setAccess(ids, open) {
    this.allowed = [...new Set(ids)].sort();
    this.open = !!open;
    this.writeAccess();
  }

  async start() {
    try {
      const bin = await ensureGatewayBinary({ ...this.opts, dataDir: path.dirname(this.dir) });
      this.writeAccess();
      const env = {
        ...process.env,
        IROH_KEY_FILE: path.join(this.dir, 'gateway.key'),
        IROH_CONFIG_FILE: this.configFile,
        RUST_LOG: process.env.RUST_LOG || 'iroh_gateway=info',
        ...(this.opts.relayUrl ? { IROH_RELAY_URL: this.opts.relayUrl } : {}),
        ...(this.opts.relayToken ? { IROH_RELAY_TOKEN: this.opts.relayToken } : {}),
      };
      // Local admin port: /status tells us the endpoint's home relay and whether it is online.
      const adminPort = this.opts.adminPort || this.port + 3;
      env.IROH_ADMIN_ADDR = `127.0.0.1:${adminPort}`;
      clearInterval(this.statusTimer);
      this.statusTimer = setInterval(() => this.pollStatus(adminPort), 15000);
      setTimeout(() => this.pollStatus(adminPort), 2500);
      this.child = spawn(bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const onLine = (line) => {
        const id = line.match(/IROH_ENDPOINT_ID=([0-9a-f]{64})/);
        if (id) this.set({ endpointId: id[1] });
        if (/forwarding to/.test(line)) this.set({ status: 'online', error: null });
        if (/\bERROR\b/.test(line)) this.set({ error: line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300) });
      };
      const log = fs.createWriteStream(path.join(this.dir, 'gateway.log'), { flags: 'a' });
      for (const s of [this.child.stdout, this.child.stderr]) s.on('data', (d) => { log.write(String(d).replace(/\x1b\[[0-9;]*m/g, '')); String(d).split('\n').forEach((l) => l.trim() && onLine(l)); });
      this.child.on('exit', (code) => {
        if (this.stopping) return;
        this.set({ status: 'reconnecting', error: `iroh-gateway exited (${code})` });
        setTimeout(() => this.start(), 5000);
      });
    } catch (err) {
      this.set({ status: 'error', error: err.message });
    }
  }

  async pollStatus(adminPort) {
    try {
      const st = await (await fetch(`http://127.0.0.1:${adminPort}/status`, { signal: AbortSignal.timeout(3000) })).json();
      const relay = st.home_relays?.find((r) => r.connected)?.url?.replace(/\.?\/?$/, '') || null;
      this.set({ endpointId: st.endpoint_id || this.state.endpointId, relayUrl: relay, status: st.online ? 'online' : 'reconnecting', connections: st.connections ?? 0 });
    } catch { /* gateway still starting */ }
  }

  stop() {
    this.stopping = true;
    clearInterval(this.statusTimer);
    try { this.child?.kill('SIGTERM'); } catch { /* gone */ }
  }
}
