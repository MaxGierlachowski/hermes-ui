#!/usr/bin/env node
// Builds the self-contained release tarball: dist/hermes-ui-<version>.tgz + .sha256 (sha256sum format).
//
//   hermes-ui/
//     bin/ src/ shared/ server.mjs scripts/{systemd-unit,launchd-plist}.mjs
//     web/dist/            prebuilt UI
//     node_modules/        production dependencies only (pure JavaScript, see the native check below)
//     package.json package-lock.json README.md LICENSE
//
// Installing needs no network and no npm: unpack and run `node hermes-ui/bin/hermes-ui.mjs serve`
// (Node >= 24). Building needs npm and the registry.
//
// Usage: npm run release:tarball [-- --skip-build] [--no-verify]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const distDir = path.join(root, 'dist');
const name = `hermes-ui-${version}.tgz`;
const log = (m) => console.log(`release: ${m}`);

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed (${r.status ?? r.signal})`);
  return r;
}

// 1. The UI build (relative URLs only, so it works at / and below HERMES_UI_BASE_PATH).
if (!args.includes('--skip-build')) {
  log('building web/dist');
  run('npm', ['--prefix', 'web', 'run', 'build'], { cwd: root });
}
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) throw new Error('web/dist is missing; build the web UI first');

// 2. Stage hermes-ui/.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-release-'));
const top = path.join(stage, 'hermes-ui');
fs.mkdirSync(top);
const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(top, rel), { recursive: true, filter: (src) => !/(^|\/)\.DS_Store$/.test(src) });
for (const rel of ['bin', 'src', 'shared', 'server.mjs', 'web/dist', 'README.md', 'LICENSE', 'package-lock.json', 'scripts/systemd-unit.mjs', 'scripts/launchd-plist.mjs']) copy(rel);
// package.json without the dev scripts (postinstall would try to install the web workspace).
const { scripts: _scripts, files: _files, ...meta } = pkg;
fs.writeFileSync(path.join(top, 'package.json'), `${JSON.stringify({ ...meta, scripts: { start: 'node bin/hermes-ui.mjs serve' } }, null, 2)}\n`);

// 3. Production dependencies, exactly as locked, without install scripts.
log('installing production dependencies');
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: top });
fs.rmSync(path.join(top, 'node_modules', '.package-lock.json'), { force: true });

// 4. Platform independence: no compiled addons, no install scripts that would build one.
const native = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'prebuilds') native.push(p); else walk(p); }
    else if (e.name.endsWith('.node') || e.name === 'binding.gyp') native.push(p);
    else if (e.name === 'package.json') {
      try {
        const s = JSON.parse(fs.readFileSync(p, 'utf8')).scripts || {};
        if (s.install || s.preinstall || s.postinstall) native.push(`${p} (install script)`);
      } catch { /* not a package manifest */ }
    }
  }
};
walk(path.join(top, 'node_modules'));
if (native.length) throw new Error(`platform-specific files in node_modules, the tarball would not be portable:\n  ${native.map((p) => path.relative(stage, p)).join('\n  ')}`);

// 5. Tarball (owner/group normalised, no macOS metadata) + checksum.
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, name);
const bsd = /bsdtar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '');
const owner = bsd ? ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root', '--no-mac-metadata', '--no-xattrs'] : ['--owner=0', '--group=0', '--numeric-owner', '--sort=name'];
run('tar', ['-czf', out, ...owner, '-C', stage, 'hermes-ui'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const sum = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sum}  ${name}\n`);
fs.rmSync(stage, { recursive: true, force: true });
log(`${path.relative(root, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
log(`sha256 ${sum}`);

// 6. Smoke test: unpack into a fresh directory and start it, offline, in proxy mode below /hermes.
if (!args.includes('--no-verify')) await verify(out);

async function verify(tgz) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-verify-'));
  try {
    run('tar', ['-xzf', tgz, '-C', dir]);
    const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); }); });
    const secret = crypto.randomBytes(24).toString('hex');
    const child = spawn(process.execPath, [path.join(dir, 'hermes-ui', 'bin', 'hermes-ui.mjs'), 'serve'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH, HOME: dir, HERMES_HOME: path.join(dir, 'hermes-home'), PASEO_HOME: path.join(dir, 'paseo-home'),
        HERMES_UI_DATA_DIR: path.join(dir, 'data'), HERMES_UI_PORT: String(port), HERMES_UI_PASEO: 'off',
        HERMES_UI_AUTH: 'proxy', HERMES_UI_PROXY_SECRET: secret, HERMES_UI_BASE_PATH: '/hermes',
      },
    });
    let outText = '';
    child.stdout.on('data', (d) => { outText += d; });
    child.stderr.on('data', (d) => { outText += d; });
    try {
      for (let i = 0; i < 200 && !/Hermes UI API on/.test(outText) && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 50));
      const base = `http://127.0.0.1:${port}`;
      const health = await fetch(`${base}/api/health`);
      const html = await (await fetch(`${base}/`)).text();
      const denied = (await fetch(`${base}/api/sessions`)).status;
      const allowed = (await fetch(`${base}/api/sessions`, { headers: { 'X-Agentbox-User': 'verify', 'X-Agentbox-Proxy-Secret': secret } })).status;
      if (health.status !== 200 || !html.includes('<base href="/hermes/">') || denied !== 401 || allowed !== 200) {
        throw new Error(`smoke test failed: health ${health.status}, base tag ${html.includes('<base href="/hermes/">')}, no-auth ${denied}, auth ${allowed}\n${outText}`);
      }
      log('verified: unpacked tarball serves /hermes/ in proxy mode (health 200, 401 without secret, 200 with it)');
    } finally { child.kill('SIGTERM'); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
