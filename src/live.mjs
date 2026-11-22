// The /api/events stream (Server-Sent Events). Every stream starts with a `hello` event that names this
// backend process (bootId), the UI build it serves (build) and the heartbeat interval, then a `ping`
// event follows every heartbeat. Clients use them to tell a live stream from a dead one (a stream over a
// tunnel or a suspended phone can stay "open" without delivering anything) and to resync their whole
// state after a reconnect, a backend restart, or a new UI build.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const HEARTBEAT_MS = 15000;

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export class LiveStream {
  constructor({ heartbeatMs = HEARTBEAT_MS, build = () => null } = {}) {
    this.bootId = crypto.randomUUID();
    this.heartbeatMs = heartbeatMs;
    this.build = build;
    this.clients = new Set();
    this.timer = setInterval(() => this.broadcast('ping', { ts: Date.now() }), heartbeatMs);
    this.timer.unref?.();
  }

  hello() {
    return { bootId: this.bootId, build: this.build(), heartbeatMs: this.heartbeatMs, ts: Date.now() };
  }

  /** Turns the response into an event stream: hello, then the initial [event, data] pairs, then live events. */
  attach(req, res, initial = []) {
    // X-Accel-Buffering: tunnels must not buffer the stream.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    req.socket?.setKeepAlive?.(true, this.heartbeatMs);
    // retry: how long a browser waits before it reconnects on its own after the stream ends.
    res.write(`retry: 2000\n${frame('hello', this.hello())}`);
    for (const [event, data] of initial) res.write(frame(event, data));
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  }

  broadcast(event, data) {
    const text = frame(event, data);
    for (const res of this.clients) {
      if (res.destroyed || res.writableEnded) { this.clients.delete(res); continue; }
      try { res.write(text); } catch { this.clients.delete(res); }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const res of this.clients) { try { res.end(); } catch { /* gone */ } }
    this.clients.clear();
  }
}

/**
 * Build id of the UI in `dir` (written by the Vite build into version.json), re-read only when the file
 * changes, so a rebuild while the backend runs is noticed by the next hello.
 */
export function buildReader(dir) {
  const file = path.join(dir, 'version.json');
  let mtime = -1;
  let build = null;
  return () => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m !== mtime) { mtime = m; build = JSON.parse(fs.readFileSync(file, 'utf8')).build || null; }
    } catch { mtime = -1; build = null; }
    return build;
  };
}
