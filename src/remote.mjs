// Built-in remote access, started together with the server (KANBAN_REMOTE):
//   off              local only (127.0.0.1)
//   iroh             see iroh.mjs (recommended)
//   cloudflare       Cloudflare quick tunnel (`cloudflared tunnel --url`), no account; URL changes on every start.
//                    Fallback only: quick tunnels have no SLA and Cloudflare documents no SSE support for them.
//   tailscale-funnel own userspace tailscaled (state in data/tailscale), public https://<host>.<tailnet>.ts.net,
//                    stable URL, works in mobile Safari without an app; needs one Tailscale login
//   tailscale-serve  same, but tailnet-only (the phone needs the Tailscale app)
// The server stays bound to 127.0.0.1; the tunnel connects from inside. Every remote request still needs
// the board token or a paired-device cookie (see auth in server.mjs).

import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Binaries come from PATH (or CLOUDFLARED_BIN / TAILSCALE_BIN / TAILSCALED_BIN), plus the usual Homebrew prefixes.
const which = (name) => {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) return override;
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map((d) => path.join(d, name)).find((p) => fs.existsSync(p)) || name;
};

export class Remote extends EventEmitter {
  constructor({ mode, port, dataDir, hostname = 'hermes-kanban', authKey }) {
    super();
    this.mode = mode || 'off';
    this.port = port;
    this.dataDir = dataDir;
    this.hostname = hostname;
    this.authKey = authKey;
    this.state = { mode: this.mode, status: this.mode === 'off' ? 'off' : 'starting', url: null, loginUrl: null, error: null };
    this.children = [];
    this.stopping = false;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  start() {
    if (this.mode === 'off') return;
    if (this.mode === 'cloudflare') this.#cloudflare();
    else if (this.mode === 'tailscale-funnel' || this.mode === 'tailscale-serve') this.#tailscale().catch((err) => this.set({ status: 'error', error: err.message }));
    else this.set({ status: 'error', error: `unknown KANBAN_REMOTE=${this.mode}` });
  }

  stop() {
    this.stopping = true;
    for (const c of this.children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }

  #spawn(cmd, args, onLine) {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.push(child);
    const feed = (buf) => String(buf).split('\n').forEach((l) => l.trim() && onLine?.(l));
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    return child;
  }

  // ---- Cloudflare quick tunnel ----
  #cloudflare(attempt = 0) {
    // --config /dev/null keeps any ~/.cloudflared config (none today) out of this ephemeral tunnel.
    const child = this.#spawn(which('cloudflared'), ['tunnel', '--no-autoupdate', '--config', '/dev/null', '--url', `http://127.0.0.1:${this.port}`], (line) => {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && this.state.url !== m[0]) this.set({ status: 'online', url: m[0], error: null });
      if (/failed to (request|register)|error=/i.test(line) && !this.state.url) this.set({ error: line.slice(0, 200) });
    });
    child.on('exit', (code) => {
      if (this.stopping) return;
      this.set({ status: 'reconnecting', url: null, error: `cloudflared exited (${code})` });
      setTimeout(() => this.#cloudflare(attempt + 1), Math.min(30000, 2000 * 2 ** attempt));
    });
  }

  // ---- Tailscale (own userspace daemon, never the system one) ----
  async #tailscale() {
    const dir = path.join(this.dataDir, 'tailscale');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sock = path.join(dir, 'tailscaled.sock');
    const ts = (args) => new Promise((resolve, reject) => {
      execFile(which('tailscale'), [`--socket=${sock}`, ...args], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err && !/https:\/\/login\.tailscale\.com/.test(String(stdout) + String(stderr))) reject(new Error(String(stderr || err.message).trim()));
        else resolve(String(stdout) + String(stderr));
      });
    });
    const daemon = this.#spawn(which('tailscaled'), ['--tun=userspace-networking', `--statedir=${dir}`, `--socket=${sock}`, '--port=0'], () => {});
    daemon.on('exit', (code) => { if (!this.stopping) this.set({ status: 'error', error: `tailscaled exited (${code})` }); });
    for (let i = 0; i < 50 && !fs.existsSync(sock); i++) await new Promise((r) => setTimeout(r, 200));

    // `up` either connects (stored state / auth key) or prints a login URL.
    const up = this.#spawn(which('tailscale'), [`--socket=${sock}`, 'up', `--hostname=${this.hostname}`, ...(this.authKey ? [`--auth-key=${this.authKey}`] : [])], (line) => {
      const m = line.match(/https:\/\/login\.tailscale\.com\/\S+/);
      if (m) this.set({ status: 'needs-login', loginUrl: m[0] });
    });
    await new Promise((resolve) => up.on('exit', resolve));
    const status = JSON.parse(await ts(['status', '--json']));
    if (status.BackendState !== 'Running') { this.set({ status: 'needs-login' }); return; }
    const dns = String(status.Self?.DNSName || '').replace(/\.$/, '');
    const verb = this.mode === 'tailscale-funnel' ? 'funnel' : 'serve';
    const out = await ts([verb, '--bg', '--yes', `http://127.0.0.1:${this.port}`]);
    const enable = out.match(/https:\/\/login\.tailscale\.com\/\S+/);
    if (enable) { this.set({ status: 'needs-approval', loginUrl: enable[0], error: `${verb} must be enabled for this tailnet once` }); return; }
    this.set({ status: 'online', url: `https://${dns}`, loginUrl: null, error: null });
  }
}
