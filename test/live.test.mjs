import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { LiveStream, buildReader } from '../src/live.mjs';

// A real HTTP server around one LiveStream, read with fetch like a browser would.
async function serve(live) {
  const server = http.createServer((req, res) => live.attach(req, res, [['gateway', { connected: true }]]));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/api/events` };
}

async function* events(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (event) yield { event, data: JSON.parse(data) };
    }
  }
}

test('a stream starts with hello (boot id, build, heartbeat), then the initial events', async () => {
  const live = new LiveStream({ heartbeatMs: 60000, build: () => 'b1' });
  const { server, url } = await serve(live);
  const ac = new AbortController();
  const res = await fetch(url, { signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const it = events(res.body);
  const hello = (await it.next()).value;
  assert.equal(hello.event, 'hello');
  assert.equal(hello.data.bootId, live.bootId);
  assert.match(live.bootId, /^[0-9a-f-]{36}$/);
  assert.equal(hello.data.build, 'b1');
  assert.equal(hello.data.heartbeatMs, 60000);
  assert.deepEqual((await it.next()).value, { event: 'gateway', data: { connected: true } });
  ac.abort();
  live.close();
  server.close();
});

test('pings arrive every heartbeat and broadcasts reach every client', async () => {
  const live = new LiveStream({ heartbeatMs: 50 });
  const { server, url } = await serve(live);
  const ac = new AbortController();
  const it = events((await fetch(url, { signal: ac.signal })).body);
  await it.next(); await it.next(); // hello, gateway
  const ping = (await it.next()).value;
  assert.equal(ping.event, 'ping');
  assert.equal(typeof ping.data.ts, 'number');
  live.broadcast('session', { id: 's1', column: 'done' });
  let ev;
  do ev = (await it.next()).value; while (ev.event === 'ping');
  assert.deepEqual(ev, { event: 'session', data: { id: 's1', column: 'done' } });
  ac.abort();
  live.close();
  server.close();
});

test('a closed client is dropped, and every process gets its own boot id', async () => {
  const live = new LiveStream({ heartbeatMs: 60000 });
  const { server, url } = await serve(live);
  const ac = new AbortController();
  const it = events((await fetch(url, { signal: ac.signal })).body);
  await it.next();
  assert.equal(live.clients.size, 1);
  ac.abort();
  for (let i = 0; i < 50 && live.clients.size; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(live.clients.size, 0);
  live.broadcast('session', { id: 'x' }); // no write to a dead socket
  assert.notEqual(new LiveStream().bootId, live.bootId);
  live.close();
  server.close();
});

test('buildReader follows version.json of the served UI and survives a missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-live-'));
  const read = buildReader(dir);
  assert.equal(read(), null);
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ build: 'one' }));
  assert.equal(read(), 'one');
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ build: 'two' }));
  fs.utimesSync(path.join(dir, 'version.json'), new Date(), new Date(Date.now() + 5000));
  assert.equal(read(), 'two');
  fs.rmSync(dir, { recursive: true });
  assert.equal(read(), null);
});
