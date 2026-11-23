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
 * @param {{ sessions?: Parameters<typeof fakeHermesState>[1] }} [opts] Hermes sessions to put into state.db
 * @returns {Promise<{ port: number, base: string, log: () => string, stop: () => Promise<void> }>}
 */
export async function startServer(env = {}, { sessions } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-test-'));
  if (sessions) await fakeHermesState(path.join(tmp, 'hermes', 'state.db'), sessions);
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

/**
 * A minimal Hermes state.db (only the tables and columns src/store.mjs reads) with the given sessions.
 * @param {string} file path of the database to create
 * @param {{ id: string, title?: string, source?: string, messages: { role: string, content: string }[] }[]} sessions
 */
export async function fakeHermesState(file, sessions) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, created_source TEXT, title TEXT, started_at REAL, ended_at REAL,
      end_reason TEXT, last_activity_at REAL, last_activity_description TEXT, message_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, parent_session_id TEXT,
      profile_name TEXT, model TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT,
      tool_name TEXT, tool_call_id TEXT, timestamp REAL, display_kind TEXT, display_metadata TEXT,
      active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0);
    CREATE TABLE session_admissions (seq INTEGER PRIMARY KEY AUTOINCREMENT, admission_id TEXT, target_session_id TEXT,
      status TEXT, outcome TEXT, payload_json TEXT);
    CREATE TABLE session_turn_leases (conversation_id TEXT, expires_at REAL);`);
  const now = Date.now() / 1000;
  for (const s of sessions) {
    db.prepare('INSERT INTO sessions (id, source, title, started_at, last_activity_at, message_count) VALUES (?, ?, ?, ?, ?, ?)')
      .run(s.id, s.source || 'cli', s.title || s.id, now - 60, now, s.messages.length);
    s.messages.forEach((m, i) => db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run(s.id, m.role, m.content, now - 60 + i));
  }
  db.close();
}
