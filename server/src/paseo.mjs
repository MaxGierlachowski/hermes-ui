// Optional adapter: read-only view of the coding agents of a Paseo daemon (https://paseo.sh), which an
// orchestrator such as Hermes starts via paseo-mcp. Disable with HERMES_UI_PASEO=off.
//
// Sources (HERMES_UI_PASEO_SOURCE = auto | mcp | daemon):
//   mcp     paseo-mcp >= 0.4.0 events (resource subscription on paseo://agents), see paseo-mcp-source.mjs.
//   daemon  a direct @getpaseo/client connection: list + agent_update stream.
// auto = mcp when PASEO_MCP_COMMAND / PASEO_MCP_URL is configured (or `paseo-mcp` is on PATH) and works,
// otherwise daemon. Even in mcp mode a reachable daemon is used for richer transcripts and the app deep link.
// Nothing here sends a prompt, archives or changes an agent. The one write path is respondPermission(),
// used when the user answers a permission in the inbox: it goes through paseo-mcp's own
// paseo_respond_permission tool (HERMES_UI_PASEO_RESPOND=off disables it).

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPaseoClient } from '@getpaseo/client';
import { McpSource } from './paseo-mcp-source.mjs';
import { localImageUrl } from './local-files.mjs';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

// Optional bookkeeping file (agent id -> goal / phase / kind), e.g. Hermes' ops-loop/paseo.json. Read-only.
function makeOpsInfo(file) {
  let cache = { at: 0, data: {} };
  return () => {
    if (!file) return {};
    if (Date.now() - cache.at < 15000) return cache.data;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); cache = { at: Date.now(), data: j.agents || j || {} }; } catch { cache = { at: Date.now(), data: {} }; }
    return cache.data;
  };
}

const onPath = (bin) => (process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, bin)));
const same = (a, b) => a && b && a.status === b.status && a.title === b.title && a.archivedAt === b.archivedAt
  && a.requiresAttention === b.requiresAttention && a.attentionReason === b.attentionReason
  && (a.pendingPermissions || []).length === (b.pendingPermissions || []).length && !!a.lastError === !!b.lastError;

export class Paseo extends EventEmitter {
  constructor({ url, opsLoopFile, source = 'auto', mcp = {}, respond = true } = {}) {
    super();
    this.respondEnabled = respond;
    this.permDetail = new Map(); // requestId -> { description, command } from the daemon (richer than paseo-mcp's summary)
    this.url = url;
    this.opsInfo = makeOpsInfo(opsLoopFile);
    this.source = source;
    this.mcpConfig = { ...mcp, command: mcp.command || (!mcp.url && onPath('paseo-mcp') ? 'paseo-mcp' : '') };
    this.agents = new Map(); // id -> agent (daemon field names)
    this.connected = false;
    this.mode = null; // 'mcp' | 'daemon'
    this.daemonOk = false;
    this.serverId = null;
    this.fetching = new Map(); // id -> promise (archived agents looked up on demand)
  }

  get sourceLabel() { return this.mode === 'mcp' ? this.mcp?.label : this.mode === 'daemon' ? `daemon ${this.url}` : null; }

  async connect() {
    const wantMcp = this.source !== 'daemon' && (this.mcpConfig.command || this.mcpConfig.url);
    if (wantMcp && await this.connectMcp()) {
      this.connectDaemon({ subscribe: false }); // optional: transcripts + deep link
      return;
    }
    if (this.source === 'mcp') { setTimeout(() => this.connect(), 15000); return; }
    await this.connectDaemon({ subscribe: true });
  }

  async connectMcp() {
    try {
      const mcp = new McpSource(this.mcpConfig);
      mcp.on('log', (m) => this.emit('log', m));
      mcp.on('agents', (list) => this.applyActive(list));
      mcp.on('closed', () => {
        if (this.mode !== 'mcp') return;
        this.connected = false;
        this.emit('status', false);
        this.emit('log', 'paseo-mcp closed; reconnecting');
        setTimeout(() => this.connect(), 5000);
      });
      await mcp.connect();
      this.mcp = mcp;
      this.mode = 'mcp';
      this.connected = true;
      this.emit('log', `paseo source: ${mcp.label}`);
      this.emit('status', true);
      return true;
    } catch (err) {
      this.emit('log', `paseo-mcp unavailable (${err.message}), falling back to the daemon`);
      return false;
    }
  }

  // The active list from paseo://agents: emit only what changed; agents that left it were archived or closed.
  applyActive(list) {
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id);
      const prev = this.agents.get(a.id);
      this.agents.set(a.id, { ...prev, ...a });
      if (!same(prev, a)) this.emit('agent', a.id);
    }
    for (const [id, a] of this.agents) {
      if (seen.has(id) || a.archivedAt) continue;
      this.agents.delete(id);
      this.fetching.delete(id);
      this.ensure(id);
      this.emit('agent', id);
    }
  }

  async connectDaemon({ subscribe }) {
    try {
      this.client = createPaseoClient({ url: this.url, clientId: 'hermes-ui', connectTimeoutMs: 8000, reconnect: { enabled: true }, logger: quiet });
      await this.client.connect();
      this.daemonOk = true;
      if (!subscribe) return;
      this.client.agents.subscribe((u) => {
        const id = u?.agent?.id || u?.agentId;
        if (!id) return;
        if (u.kind === 'remove') {
          // Archived agents leave the live list; fetch their final snapshot so cards show them greyed out.
          this.agents.delete(id);
          this.fetching.delete(id);
          this.ensure(id);
        } else if (u.agent?.status) this.agents.set(id, u.agent);
        this.emit('agent', id);
      });
      const res = await this.client.agents.list({ filter: { includeArchived: false }, subscribe: {} });
      for (const e of res.entries) this.agents.set(e.agent.id, e.agent);
      this.mode = 'daemon';
      this.connected = true;
      this.emit('log', `paseo source: daemon ${this.url}`);
      this.emit('status', true);
    } catch (err) {
      this.daemonOk = false;
      if (!subscribe) return; // only an optional helper in mcp mode
      this.connected = false;
      this.emit('log', `paseo connect failed: ${err.message}`);
      setTimeout(() => this.connect(), 15000);
    }
  }

  // Agent snapshot by id; archived agents are not in the live list, so fetch them once on demand.
  async ensure(id) {
    if (this.agents.has(id) || !this.connected) return this.agents.get(id) || null;
    if (!this.fetching.has(id)) {
      this.fetching.set(id, (async () => {
        try {
          let a = null;
          if (this.mode === 'mcp') a = await this.mcp.getAgent(id);
          else {
            const h = this.client.agents.ref(id);
            await h.refresh();
            a = h.current();
            this.serverId ||= h.address?.serverId || null;
          }
          if (a) { this.agents.set(id, a); this.emit('agent', id); }
          else this.fetching.delete(id); // retry later instead of caching a miss
          return a;
        } catch { this.fetching.delete(id); return null; }
      })());
    }
    return this.fetching.get(id);
  }

  resolve(idOrPrefix) {
    if (this.agents.has(idOrPrefix)) return idOrPrefix;
    const hits = [...this.agents.keys()].filter((k) => k.startsWith(idOrPrefix));
    return hits.length === 1 ? hits[0] : null;
  }

  view(id) {
    const a = this.agents.get(id);
    if (!a) return { id, title: null, status: 'unknown', known: false };
    if (!this.serverId && this.daemonOk) this.serverId = this.client?.agents.ref(id).address?.serverId || null;
    const ops = this.opsInfo()[id] || {};
    const pending = (a.pendingPermissions || []).length;
    // requiresAttention with reason "finished" only means "done, not looked at yet" in the Paseo app.
    const blocked = pending > 0 || (a.requiresAttention && a.attentionReason && a.attentionReason !== 'finished');
    const state = a.archivedAt ? 'archived'
      : blocked ? 'needs-attention'
        : a.status === 'error' || (a.lastError && a.status !== 'running') ? 'error'
          : a.status === 'running' ? 'running'
            : a.requiresAttention && a.attentionReason === 'finished' ? 'finished'
              : a.status;
    return {
      id,
      known: true,
      title: a.title || ops.goal || id.slice(0, 8),
      status: a.status,
      state, // running | idle | closed | error | needs-attention | archived
      archived: !!a.archivedAt,
      pendingPermissions: (a.pendingPermissions || []).map((p) => permissionView(p, this.permDetail.get(p.id))),
      attentionReason: a.attentionReason || null,
      lastError: a.lastError ? String(a.lastError.message || a.lastError).slice(0, 300) : null,
      account: a.labels?.account || null,
      kind: a.labels?.kind || ops.kind || null,
      origin: a.labels?.origin || null,
      goal: ops.goal || null,
      phase: ops.phase || null,
      model: a.model || null,
      cwd: a.cwd || null,
      updatedAt: a.updatedAt || null,
      createdAt: a.createdAt || null,
      deepLink: this.serverId ? `paseo://h/${encodeURIComponent(this.serverId)}/agent/${encodeURIComponent(id)}` : null,
    };
  }

  /** Fills in what a pending permission is about (description, command) from the daemon, if reachable. */
  async permissionDetails(id) {
    const a = this.agents.get(id);
    const missing = (a?.pendingPermissions || []).filter((p) => p.id && !this.permDetail.has(p.id) && !p.description && !p.input);
    if (!missing.length || !this.daemonOk) return false;
    try {
      const h = this.client.agents.ref(id);
      await h.refresh();
      for (const p of h.current()?.pendingPermissions || []) this.permDetail.set(p.id, { description: p.description || null, command: commandOf(p), actions: p.actions || null });
      if (this.permDetail.size > 500) this.permDetail = new Map([...this.permDetail].slice(-200));
      return true;
    } catch { return false; }
  }

  get canRespond() { return this.respondEnabled && !!(this.mcpConfig.command || this.mcpConfig.url); }

  /**
   * Answers a pending permission through paseo-mcp's paseo_respond_permission (a separate, short-lived
   * client that is not read-only; the event subscription stays read-only).
   */
  async respondPermission(agentId, requestId, decision, message) {
    if (!this.canRespond) throw new Error('Answering Paseo permissions is disabled (needs paseo-mcp, HERMES_UI_PASEO_RESPOND=on)');
    const mcp = new McpSource({ ...this.mcpConfig, readOnly: false });
    try {
      await mcp.open();
      return await mcp.respondPermission(agentId, requestId, decision, message);
    } finally { mcp.close(); }
  }

  // Read-only transcript, projected like the Paseo app shows it. Reasoning is left out.
  async timeline(id, limit = 150) {
    if (!this.connected) throw new Error('Paseo not connected');
    if (!this.daemonOk) {
      const t = await this.mcp.timeline(id, limit);
      return { agent: this.view(id), items: t.items, hasOlder: t.hasOlder, source: 'paseo-mcp' };
    }
    const page = await this.client.agents.ref(id).timeline.refetch({ direction: 'tail', limit, projection: 'projected' });
    if (page.error) throw new Error(page.error);
    if (page.agent) this.agents.set(id, page.agent);
    const items = [];
    for (const e of page.entries) {
      const it = e.item;
      const ts = Date.parse(e.timestamp) / 1000;
      if (it.type === 'user_message') items.push({ role: 'user', text: it.text, ts, images: imagesOf(it) });
      else if (it.type === 'assistant_message') items.push({ role: 'assistant', text: it.text, ts, images: imagesOf(it) });
      else if (it.type === 'tool_call') items.push({ role: 'tool', toolName: it.name, status: it.status, summary: toolSummary(it), text: toolText(it), ts, images: imagesOf(it.detail) });
      else if (it.type === 'todo') items.push({ role: 'todo', ts, todos: (it.items || []).map((x) => ({ text: x.text, done: !!x.completed })) });
      else if (it.type === 'error') items.push({ role: 'error', text: it.message, ts });
      else if (it.type === 'notification') items.push({ role: 'notice', text: it.message, level: it.level, ts });
    }
    return { agent: this.view(id), items, hasOlder: !!page.hasOlder, source: 'daemon' };
  }
}

function commandOf(p) {
  const i = p.input || {};
  const d = p.detail || {};
  const c = i.command || d.command || i.file_path || d.path || i.url || i.pattern || '';
  return c ? String(c).slice(0, 2000) : null;
}

function permissionView(p, extra = {}) {
  return {
    id: p.id || null,
    kind: p.kind,
    name: p.name,
    title: p.title || null,
    description: (p.description || extra?.description || null)?.slice?.(0, 600) ?? null,
    command: commandOf(p) || extra?.command || null,
    actions: (p.actions || extra?.actions || null)?.map?.(({ id, label, behavior }) => ({ id, label, behavior })) ?? null,
  };
}

function imagesOf(x) {
  const list = [...(x?.images || []), ...(x?.attachments || [])];
  return list.map((i) => {
    if (typeof i === 'string') return /^(https?:|data:)/.test(i) ? i : localImageUrl(i);
    if (i?.data && i?.mimeType) return `data:${i.mimeType};base64,${i.data}`;
    if (i?.dataUrl) return i.dataUrl;
    if (i?.url) return /^(https?:|data:)/.test(i.url) ? i.url : localImageUrl(i.url);
    if (i?.path) return localImageUrl(i.path);
    return null;
  }).filter(Boolean).slice(0, 6);
}

function toolSummary(it) {
  const d = it.detail || {};
  const s = d.command || d.path || d.file_path || d.pattern || d.url || d.query || d.description || '';
  return String(s).replace(/\s+/g, ' ').slice(0, 140);
}

function toolText(it) {
  const d = it.detail || {};
  const parts = [];
  if (d.command) parts.push(`$ ${d.command}`);
  for (const k of ['output', 'result', 'stdout', 'content', 'text']) if (typeof d[k] === 'string' && d[k]) { parts.push(d[k]); break; }
  if (!parts.length) { const { type: _t, ...rest } = d; if (Object.keys(rest).length) parts.push(JSON.stringify(rest, null, 2)); }
  if (it.status === 'failed' && it.error) parts.push(`Fehler: ${typeof it.error === 'string' ? it.error : JSON.stringify(it.error)}`);
  return parts.join('\n').slice(0, 6000);
}
