// Client for the running Hermes gateway, speaking the same protocol as the Hermes desktop app:
//   1. ~/.hermes/gateway.sock (one JSON line per request): `identify` + single-use `session-ticket`s
//   2. ws://127.0.0.1:<api_port>/api/ws, JSON-RPC 2.0, ticket in the subprotocol, no Origin header
//   3. REST on the same origin with `X-Hermes-Gateway-Ticket` (purpose native-http) for image upload + STT
// Nothing here restarts or reconfigures the gateway.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

function control(socketPath, verb, params) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`control ${verb}: timeout`)); }, 5000);
    sock.on('connect', () => sock.write(`${JSON.stringify({ protocol: 1, id: 1, verb, ...(params ? { params } : {}) })}\n`));
    sock.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      sock.end();
      try {
        const msg = JSON.parse(buf.slice(0, nl));
        if (msg.error) reject(new Error(`control ${verb}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result ?? msg);
      } catch (err) { reject(err); }
    });
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export class HermesGateway extends EventEmitter {
  constructor({ hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes') } = {}) {
    super();
    this.hermesHome = hermesHome;
    this.controlSocket = path.join(hermesHome, 'gateway.sock');
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.connected = false;
    this.identity = null;
    this.subscribed = new Set();
    this.backoff = 1000;
  }

  async identify() {
    this.identity = await control(this.controlSocket, 'identify');
    const profile = (this.identity.served_profiles || []).find((p) => p.profile_id === this.hermesHome) || this.identity.served_profiles?.[0];
    this.profileId = profile?.profile_id || this.hermesHome;
    this.origin = this.identity.api_origin;
    return this.identity;
  }

  async ticket(purpose, scope) {
    const res = await control(this.controlSocket, 'session-ticket', {
      profile_id: this.profileId,
      instance_id: this.identity.instance_id,
      purpose,
      ...(scope ? { scope } : {}),
    });
    return res.ticket;
  }

  async connect() {
    try {
      await this.identify();
      const ticket = await this.ticket('interactive', 'host');
      const wsUrl = `${this.origin.replace(/^http/, 'ws')}/api/ws`;
      // Node's WebSocket (undici) sends no Origin header, which the gateway requires for local clients.
      const ws = new WebSocket(wsUrl, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.backoff = 1000;
        this.emit('status', true);
        // Re-subscribe to sessions we were following before a reconnect.
        for (const id of this.subscribed) this.resume(id).catch(() => {});
      };
      ws.onmessage = (ev) => this.#onFrame(ev.data);
      ws.onclose = () => this.#onClose();
      ws.onerror = () => {};
    } catch (err) {
      this.emit('log', `gateway connect failed: ${err.message}`);
      this.#scheduleReconnect();
    }
  }

  #onClose() {
    const wasConnected = this.connected;
    this.connected = false;
    for (const { reject } of this.pending.values()) reject(new Error('gateway connection closed'));
    this.pending.clear();
    if (wasConnected) this.emit('status', false);
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  #onFrame(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'event' && msg.params) this.emit('event', msg.params);
  }

  call(method, params = {}, timeoutMs = 30000) {
    if (!this.connected) return Promise.reject(new Error('Hermes gateway not connected'));
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timeout`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async rest(method, urlPath, body) {
    if (!this.identity) await this.identify();
    const ticket = await this.ticket('native-http');
    const res = await fetch(`${this.origin}${urlPath}`, {
      method,
      headers: { 'X-Hermes-Gateway-Ticket': ticket, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`${method} ${urlPath}: ${res.status} ${text.slice(0, 300)}`);
    return json;
  }

  // ---- high-level helpers ----

  async createSession({ title } = {}) {
    const snap = await this.call('session.create', {
      source: 'gui',
      cwd: os.homedir(),
      ...(title ? { title } : {}),
      request_id: randomUUID(),
      client: { name: 'hermes-kanban', version: '0.1.0' },
    });
    const id = snap.session_id || snap.stored_session_id;
    this.subscribed.add(id);
    return { id, snap };
  }

  // Subscribes this socket to the session's live events; the snapshot carries pending prompts.
  async resume(id) {
    const snap = await this.call('session.resume', { session_id: id, omit_messages: true });
    this.subscribed.add(id);
    this.emit('snapshot', id, snap);
    return snap;
  }

  async respondApproval(id, { generation, promptId, choice }) {
    if (!this.subscribed.has(id)) await this.resume(id);
    return this.call('approval.respond', { session_id: id, execution_generation: generation, prompt_id: promptId, choice });
  }

  async respondClarify(id, { generation, promptId, answer }) {
    if (!this.subscribed.has(id)) await this.resume(id);
    return this.call('clarify.respond', { session_id: id, execution_generation: generation, prompt_id: promptId, answer });
  }

  async submit(id, { text, attachments = [], voice = false }) {
    if (!this.subscribed.has(id)) await this.resume(id);
    return this.call('prompt.submit', {
      session_id: id,
      text,
      submission_id: randomUUID(),
      ...(attachments.length ? { attachments } : {}),
      ...(voice ? { voice_turn: true } : {}),
    });
  }

  async interrupt(id, executionGeneration) {
    return this.call('session.interrupt', { session_id: id, execution_generation: executionGeneration });
  }

  async uploadImage({ data, type, name }) {
    const res = await this.rest('POST', '/api/chat/image-upload', { data_url: `data:${type};base64,${data}`, filename: name });
    return { path: res.path, mime: res.mime_type || type };
  }

  async transcribe({ data, type }) {
    return this.rest('POST', '/api/audio/transcribe', { data_url: `data:${type};base64,${data}`, mime_type: type });
  }
}
