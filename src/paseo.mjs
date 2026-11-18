// Optional adapter: read-only view of a local Paseo daemon (https://paseo.sh), whose coding agents an
// orchestrator such as Hermes starts via paseo-mcp. Disable with KANBAN_PASEO=off.
// Source today: a direct daemon connection. Once paseo-mcp exposes an event stream, this class is the
// one place to swap the source; the rest of the server only uses agents/view/timeline/ensure/resolve.
// Uses only list / ref().refresh() / timeline.refetch and the agent_update stream: nothing here
// sends a prompt, answers a permission, archives or changes an agent, or touches the daemon.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPaseoClient } from '@getpaseo/client';

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

export class Paseo extends EventEmitter {
  constructor({ url, opsLoopFile } = {}) {
    super();
    this.url = url;
    this.opsInfo = makeOpsInfo(opsLoopFile);
    this.agents = new Map(); // id -> raw PaseoAgent
    this.connected = false;
    this.serverId = null;
    this.fetching = new Map(); // id -> promise (archived agents looked up on demand)
  }

  async connect() {
    try {
      this.client = createPaseoClient({ url: this.url, clientId: 'hermes-kanban', connectTimeoutMs: 8000, reconnect: { enabled: true }, logger: quiet });
      await this.client.connect();
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
      this.connected = true;
      this.emit('status', true);
    } catch (err) {
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
          const h = this.client.agents.ref(id);
          await h.refresh();
          const a = h.current();
          if (a) { this.agents.set(id, a); this.serverId ||= h.address?.serverId || null; this.emit('agent', id); }
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
    if (!this.serverId) this.serverId = this.client?.agents.ref(id).address?.serverId || null;
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
      pendingPermissions: (a.pendingPermissions || []).map((p) => ({ kind: p.kind, name: p.name, title: p.title || null })),
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

  // Read-only transcript, projected like the Paseo app shows it. Reasoning is left out.
  async timeline(id, limit = 150) {
    if (!this.connected) throw new Error('Paseo daemon not connected');
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
    return { agent: this.view(id), items, hasOlder: !!page.hasOlder };
  }
}

function imagesOf(x) {
  const list = [...(x?.images || []), ...(x?.attachments || [])];
  return list.map((i) => {
    if (typeof i === 'string') return i.startsWith('data:') || i.startsWith('http') ? i : null;
    if (i?.data && i?.mimeType) return `data:${i.mimeType};base64,${i.data}`;
    if (i?.dataUrl) return i.dataUrl;
    if (i?.url && /^(https?:|data:)/.test(i.url)) return i.url;
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
