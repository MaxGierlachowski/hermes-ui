// Paseo agent state via paseo-mcp (>= 0.4.0) instead of a direct daemon connection.
// Two transports, same protocol:
//   stdio  PASEO_MCP_COMMAND, e.g. "paseo-mcp" or "node /path/to/paseo-mcp/dist/index.js". Started with
//          PASEO_MCP_READONLY=1, so this process cannot start, steer or archive agents.
//   http   PASEO_MCP_URL + PASEO_MCP_TOKEN: the Paseo plugin's Streamable HTTP endpoint. Use a token with
//          the `read` scope.
// It subscribes to the resource paseo://agents; on notifications/resources/updated it reads the resource
// again. Archived agents (not in that list) come from paseo_get_agent, transcripts from paseo_read_timeline.

import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ResourceListChangedNotificationSchema, ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const AGENTS_URI = 'paseo://agents';

// Splits a command line into argv, honouring simple quotes.
const splitCommand = (cmd) => (cmd.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ''));

/** paseo-mcp's agent summary -> the field names of the daemon's agent objects. */
export function fromSummary(s) {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    requiresAttention: !!s.needsAttention,
    attentionReason: s.attentionReason ?? null,
    pendingPermissions: (s.pendingPermissions || []).map((p) => ({ id: p.requestId, kind: p.kind, name: p.name, title: p.title ?? null })),
    lastError: s.lastError ?? null,
    labels: { ...(s.labels || {}), ...(s.account && !s.labels?.account ? { account: s.account } : {}) },
    model: s.model ?? null,
    cwd: s.cwd ?? null,
    updatedAt: s.updatedAt ?? null,
    archivedAt: s.archivedAt ?? null,
  };
}

const textOf = (res) => (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const jsonOf = (text) => { const i = text.indexOf('{'); return i >= 0 ? JSON.parse(text.slice(i)) : null; };

export class McpSource extends EventEmitter {
  constructor({ command, url, token, version = '0' }) {
    super();
    this.command = command;
    this.url = url;
    this.token = token;
    this.version = version;
    this.connected = false;
  }

  get label() { return this.url ? `paseo-mcp http ${new URL(this.url).host}` : `paseo-mcp stdio (${splitCommand(this.command)[0]})`; }

  async connect() {
    const transport = this.url
      ? new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} } })
      : (() => {
        const [cmd, ...args] = splitCommand(this.command);
        return new StdioClientTransport({ command: cmd, args, env: { ...process.env, PASEO_MCP_READONLY: '1' }, stderr: 'ignore' });
      })();
    const client = new Client({ name: 'hermes-ui', version: this.version });
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, () => this.scheduleRefresh());
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => this.scheduleRefresh());
    await client.connect(transport);
    this.client = client;
    transport.onclose = () => { this.connected = false; this.emit('closed'); };
    await this.refresh();
    await client.subscribeResource({ uri: AGENTS_URI });
    this.connected = true;
  }

  scheduleRefresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh().catch((err) => this.emit('log', `paseo-mcp refresh: ${err.message}`)), 150);
  }

  /** Reads paseo://agents and emits the active agents (already mapped with fromSummary). */
  async refresh() {
    const res = await this.client.readResource({ uri: AGENTS_URI });
    const data = JSON.parse(res.contents?.[0]?.text || '{}');
    this.emit('agents', (data.agents || []).map(fromSummary));
  }

  async getAgent(id) {
    const res = await this.client.callTool({ name: 'paseo_get_agent', arguments: { agent_id: id } });
    if (res.isError) return null;
    const s = jsonOf(textOf(res));
    return s?.id ? fromSummary(s) : null;
  }

  /** paseo_read_timeline's compact transcript, parsed back into items. */
  async timeline(id, limit = 150) {
    const res = await this.client.callTool({
      name: 'paseo_read_timeline',
      arguments: { agent_id: id, limit: Math.min(limit, 200), include_tool_calls: true, max_chars_per_entry: 4000 },
    });
    if (res.isError) throw new Error(textOf(res).replace(/^Error:\s*/, ''));
    return parseTranscript(textOf(res));
  }

  async close() { try { await this.client?.close(); } catch { /* gone */ } }
}

// "[12:01:09] USER: …" / "AGENT: …" / "TOOL Bash (completed) error=…" / "TODO: [x] a | [ ] b" / "ERROR: …" / "WARN: …"
export function parseTranscript(text) {
  const items = [];
  let hasOlder = false;
  const day = new Date().toISOString().slice(0, 10);
  for (const line of text.split('\n')) {
    if (/older entries exist/.test(line) && !items.length) hasOlder = true;
    const m = line.match(/^\[(\d\d:\d\d:\d\d)\] (USER|AGENT|TOOL|TODO|ERROR|WARN|INFO|THINKING)[: ]\s?(.*)$/);
    if (!m) {
      const last = items[items.length - 1];
      if (last && (last.role === 'user' || last.role === 'assistant' || last.role === 'error')) last.text += `\n${line}`;
      continue;
    }
    const ts = Date.parse(`${day}T${m[1]}Z`) / 1000;
    const [, , kind, rest] = m;
    if (kind === 'USER') items.push({ role: 'user', text: rest, ts });
    else if (kind === 'AGENT') items.push({ role: 'assistant', text: rest, ts });
    else if (kind === 'TOOL') {
      const t = rest.match(/^(\S+) \((\w+)\)(?: error=(.*))?$/);
      items.push({ role: 'tool', toolName: t?.[1] || rest, status: t?.[2] || '', summary: '', text: t?.[3] ? `Error: ${t[3]}` : '', ts });
    } else if (kind === 'TODO') items.push({ role: 'todo', ts, todos: rest.split(' | ').map((x) => ({ done: x.startsWith('[x]'), text: x.replace(/^\[[x ]\]\s*/, '') })) });
    else if (kind === 'ERROR') items.push({ role: 'error', text: rest, ts });
    else if (kind !== 'THINKING') items.push({ role: 'notice', text: rest, level: kind.toLowerCase(), ts });
  }
  for (const it of items) if (it.text) it.text = it.text.trim();
  return { items, hasOlder };
}
