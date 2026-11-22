// Starts the real server (bin/hermes-ui.mjs serve) in a child process with throwaway directories:
// no Hermes, no Paseo, a fake UI build. Every path and the port are private to the test.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

/** A minimal stand-in for web/dist: index.html with relative URLs, one asset, sw.js and a manifest. */
export function fakeUi(dir) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>\n<html lang="en">\n  <head>\n    <link rel="manifest" href="./manifest.webmanifest" />\n    <script type="module" src="./assets/index-test.js"></script>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n');
  fs.writeFileSync(path.join(dir, 'assets', 'index-test.js'), 'console.log("ui")\n');
  fs.writeFileSync(path.join(dir, 'sw.js'), '// sw\n');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"start_url":"./","scope":"./"}\n');
  return dir;
}

/**
 * @param {Record<string,string>} env extra environment (HERMES_UI_AUTH, HERMES_UI_BASE_PATH, …)
 * @returns {Promise<{ port: number, base: string, log: () => string, stop: () => Promise<void> }>}
 */
export async function startServer(env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'hermes-ui.mjs'), 'serve'], {
    env: {
      PATH: process.env.PATH,
      HOME: tmp,
      HERMES_HOME: path.join(tmp, 'hermes'),
      PASEO_HOME: path.join(tmp, 'paseo'),
      PASEO_MCP_CONFIG: path.join(tmp, 'paseo-mcp.json'),
      HERMES_UI_DATA_DIR: path.join(tmp, 'data'),
      HERMES_UI_ENV_FILE: path.join(tmp, '.env'),
      HERMES_UI_DIR: fakeUi(path.join(tmp, 'ui')),
      HERMES_UI_PASEO: 'off',
      HERMES_UI_PUSH: 'off',
      HERMES_UI_PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const deadline = Date.now() + 10000;
  let started = false;
  while (child.exitCode === null && Date.now() < deadline) {
    if (/Hermes UI API on/.test(out)) { started = true; break; }
    await new Promise((r) => setTimeout(r, 25));
  }
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; } fs.rmSync(tmp, { recursive: true, force: true }); };
  if (!started) { await stop(); throw Object.assign(new Error(`server did not start:\n${out}`), { output: out }); }
  return { port, base: `http://127.0.0.1:${port}`, log: () => out, stop };
}

/** Runs the server expecting it to refuse to start; resolves with its output. */
export async function startupError(env) {
  try { const s = await startServer(env); await s.stop(); return null; } catch (err) { return err.output ?? String(err); }
}
