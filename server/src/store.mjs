// Read-only view of Hermes' session store (~/.hermes/state.db, SQLite WAL).
// Writes never go through here: new turns go through the gateway WebSocket (see hermes-ws.mjs).

import { DatabaseSync } from 'node:sqlite';

const SESSION_COLS = `s.id, s.source, s.created_source, s.title, s.started_at, s.ended_at, s.end_reason,
  s.last_activity_at, s.last_activity_description, s.message_count, s.tool_call_count,
  s.archived, s.hidden, s.parent_session_id, s.profile_name, s.model`;

export class Store {
  constructor(path) {
    this.path = path;
    this.db = new DatabaseSync(path, { readOnly: true });
    this.db.exec('PRAGMA query_only = 1; PRAGMA busy_timeout = 3000;');
  }

  // One row per session plus the facts the board needs: first user prompt, last message, running turn.
  listSessions({ sinceTs, sources, ids = [] }) {
    const where = ['s.hidden = 0', 's.archived = 0', 's.parent_session_id IS NULL'];
    const params = [];
    const idFilter = ids.length ? ` OR s.id IN (${ids.map(() => '?').join(',')})` : '';
    where.push(`(COALESCE(s.last_activity_at, s.started_at) >= ?${idFilter})`);
    params.push(sinceTs, ...ids);
    if (sources?.length) {
      where.push(`(s.source IN (${sources.map(() => '?').join(',')})${idFilter})`);
      params.push(...sources, ...ids);
    }
    const rows = this.db.prepare(`
      SELECT ${SESSION_COLS},
        (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_prompt,
        (SELECT role FROM messages m WHERE m.session_id = s.id AND m.active = 1 AND m.role IN ('user','assistant','tool') ORDER BY m.id DESC LIMIT 1) AS last_role,
        (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' AND m.content <> '' ORDER BY m.id DESC LIMIT 1) AS last_assistant,
        (SELECT max(m.id) FROM messages m WHERE m.session_id = s.id) AS last_msg_id,
        (SELECT max(m.id) FROM messages m WHERE m.session_id = s.id AND m.role = 'user') AS last_user_id,
        (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.active = 1 ORDER BY m.id DESC LIMIT 1) AS last_user,
        (SELECT display_kind FROM messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.active = 1 ORDER BY m.id DESC LIMIT 1) AS last_user_kind,
        (SELECT max(m.id) FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' AND m.content <> '') AS last_assistant_id,
        EXISTS (SELECT 1 FROM session_admissions a WHERE a.target_session_id = s.id AND a.status IN ('queued','started')) AS admitted,
        EXISTS (SELECT 1 FROM session_turn_leases l WHERE l.conversation_id = s.id AND l.expires_at > unixepoch('subsec')) AS leased
      FROM sessions s
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC
      LIMIT 400`).all(...params);
    return rows;
  }

  getSession(id) {
    return this.db.prepare(`
      SELECT ${SESSION_COLS},
        (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_prompt,
        (SELECT role FROM messages m WHERE m.session_id = s.id AND m.active = 1 AND m.role IN ('user','assistant','tool') ORDER BY m.id DESC LIMIT 1) AS last_role,
        (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' AND m.content <> '' ORDER BY m.id DESC LIMIT 1) AS last_assistant,
        (SELECT max(m.id) FROM messages m WHERE m.session_id = s.id) AS last_msg_id,
        (SELECT max(m.id) FROM messages m WHERE m.session_id = s.id AND m.role = 'user') AS last_user_id,
        (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.active = 1 ORDER BY m.id DESC LIMIT 1) AS last_user,
        (SELECT display_kind FROM messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.active = 1 ORDER BY m.id DESC LIMIT 1) AS last_user_kind,
        (SELECT max(m.id) FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' AND m.content <> '') AS last_assistant_id,
        EXISTS (SELECT 1 FROM session_admissions a WHERE a.target_session_id = s.id AND a.status IN ('queued','started')) AS admitted,
        EXISTS (SELECT 1 FROM session_turn_leases l WHERE l.conversation_id = s.id AND l.expires_at > unixepoch('subsec')) AS leased
      FROM sessions s WHERE s.id = ?`).get(id);
  }

  // Only the live transcript: active = 0 rows were taken back (/undo, refused turns) or replaced
  // (a drained busy-queue row gets re-placed at the end); Hermes' own clients hide them too.
  messages(id) {
    return this.db.prepare(`
      SELECT id, role, content, tool_calls, tool_name, tool_call_id, timestamp, display_kind, display_metadata
      FROM messages WHERE session_id = ? AND role IN ('user','assistant','tool') AND compacted = 0 AND active = 1
      ORDER BY id`).all(id);
  }

  // Hermes' durable FIFO per session (gateway-owned sessions): a prompt sent while a turn runs waits
  // here as status 'queued' and is written to messages only when its own turn starts.
  admissions(id, limit = 40) {
    return this.db.prepare(`
      SELECT seq, admission_id, status, outcome, json_extract(payload_json, '$.text') AS text
      FROM session_admissions WHERE target_session_id = ? ORDER BY seq DESC LIMIT ?`).all(id, limit).reverse();
  }

  // User rows after a message id, for matching messages the board sent (see outbox.mjs).
  userRowsSince(id, sinceId) {
    return this.db.prepare(`
      SELECT id, content, display_kind, display_metadata, active FROM messages
      WHERE session_id = ? AND role = 'user' AND id > ? ORDER BY id`).all(id, sinceId);
  }

  // Cheap change detector for the poll loop.
  watermark() {
    const r = this.db.prepare(`SELECT
      (SELECT max(id) FROM messages) AS msg,
      (SELECT max(COALESCE(last_activity_at, started_at)) FROM sessions) AS act,
      (SELECT count(*) FROM sessions) AS n,
      (SELECT max(seq) FROM session_admissions) AS adm,
      (SELECT count(*) FROM session_admissions WHERE status IN ('queued','started')) AS running,
      (SELECT count(*) FROM session_turn_leases) AS leases`).get();
    return `${r.msg}|${r.act}|${r.n}|${r.adm}|${r.running}|${r.leases}`;
  }

  // Sessions touched since a message id / activity timestamp, for incremental pushes.
  changedSince(msgId, actTs) {
    return this.db.prepare(`
      SELECT DISTINCT s.id FROM sessions s
      WHERE COALESCE(s.last_activity_at, s.started_at) > ?
         OR s.id IN (SELECT DISTINCT session_id FROM messages WHERE id > ?)
         OR s.id IN (SELECT target_session_id FROM session_admissions WHERE status IN ('queued','started'))
         OR s.id IN (SELECT conversation_id FROM session_turn_leases)`).all(actTs, msgId).map((r) => r.id);
  }

  // Messages that tie a session to Paseo agents: create_agent results (carry the new id) and
  // assistant tool calls to paseo_* tools (carry agent_id in their arguments).
  paseoRefs(sinceId) {
    return this.db.prepare(`
      SELECT id, session_id, role, tool_name, content, tool_calls, timestamp FROM messages
      WHERE id > ? AND ((role = 'tool' AND tool_name = 'mcp__paseo__paseo_create_agent')
        OR (role = 'assistant' AND tool_calls LIKE '%mcp__paseo__paseo_%'))
      ORDER BY id`).all(sinceId);
  }

  // Sessions that started child agents of their own (src/hermes-children.mjs): delegate_task results,
  // and terminal calls that run `hermes … chat`. The LIKE filter is coarse; the parser decides.
  childRefs(sinceId) {
    return this.db.prepare(`
      SELECT DISTINCT session_id FROM messages
      WHERE id > ? AND ((role = 'tool' AND tool_name = 'delegate_task')
        OR (role = 'assistant' AND tool_calls LIKE '%delegate_task%')
        OR (role = 'assistant' AND tool_calls LIKE '%terminal%' AND tool_calls LIKE '%hermes%' AND tool_calls LIKE '%chat%'))`).all(sinceId).map((r) => r.session_id);
  }

  // The rows of one chat that childCalls() reads: the calls, their results, the completion notices.
  childRows(sessionId) {
    const calls = this.db.prepare(`
      SELECT id, role, tool_calls, timestamp FROM messages
      WHERE session_id = ? AND role = 'assistant' AND active = 1
        AND (tool_calls LIKE '%delegate_task%' OR (tool_calls LIKE '%terminal%' AND tool_calls LIKE '%hermes%' AND tool_calls LIKE '%chat%'))
      ORDER BY id`).all(sessionId);
    if (!calls.length) return [];
    const results = this.db.prepare(`
      SELECT id, role, tool_name, tool_call_id, content, timestamp FROM messages
      WHERE session_id = ? AND role = 'tool' AND tool_name IN ('delegate_task', 'terminal') AND id >= ?
      ORDER BY id`).all(sessionId, calls[0].id);
    const notices = this.db.prepare(`
      SELECT id, role, substr(content, 1, 600) AS content, timestamp, display_kind FROM messages
      WHERE session_id = ? AND role = 'user' AND display_kind IN ('process_complete', 'async_delegation_complete') AND id >= ?
      ORDER BY id`).all(sessionId, calls[0].id);
    return [...calls, ...results, ...notices].sort((a, b) => a.id - b.id);
  }

  // delegate_task children of a chat (all segments: compression continues a child in a new row).
  subagentSessions(parentId) {
    return this.db.prepare(`
      SELECT s.id, s.title, s.started_at, s.ended_at, s.end_reason, s.last_activity_at, s.message_count, s.model,
        json_extract(s.model_config, '$._subagent_id') AS subagent_id,
        (SELECT substr(content, 1, 4000) FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_prompt
      FROM sessions s
      WHERE s.source = 'subagent' AND (s.parent_session_id = ? OR json_extract(s.model_config, '$._delegate_from') = ?)
      ORDER BY s.started_at`).all(parentId, parentId);
  }

  // Background delegations: the authoritative completed / error record (async_delegations).
  delegations(ids) {
    if (!ids.length) return [];
    try {
      return this.db.prepare(`SELECT delegation_id, state, completed_at, owner_pid FROM async_delegations
        WHERE delegation_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    } catch { return []; } // older Hermes without the table
  }

  // Top-level sessions that started in a time window, with their first prompt: candidates for a
  // terminal `hermes chat` run (src/hermes-children.mjs matchTerminal).
  sessionsStartedBetween(from, to) {
    return this.db.prepare(`
      SELECT s.id, s.source, s.created_source, s.title, s.started_at, s.ended_at, s.end_reason,
        s.last_activity_at, s.message_count, s.model,
        (SELECT substr(content, 1, 20000) FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_prompt
      FROM sessions s
      WHERE s.parent_session_id IS NULL AND s.started_at BETWEEN ? AND ?
      ORDER BY s.started_at LIMIT 50`).all(from, to);
  }

  sessionBrief(id) {
    return this.db.prepare(`SELECT id, source, title, started_at, ended_at, end_reason, last_activity_at, message_count, model, parent_session_id
      FROM sessions WHERE id = ?`).get(id);
  }

  // Full-text search over chat content with Hermes' own FTS5 index (messages_fts, kept current by
  // Hermes), plus a title match. Only user and assistant text; tool output and tool calls are left out.
  // Returns the best hit per session, ranked by bm25; snippets mark hits with \u0002 … \u0003.
  search(query, { includeArchived = false, limit = 30 } = {}) {
    const tokens = String(query || '').normalize('NFC').split(/\s+/).map((t) => t.replace(/["*]/g, '')).filter(Boolean).slice(0, 8);
    if (!tokens.length) return { title: [], content: [] };
    const visible = `s.hidden = 0 AND s.parent_session_id IS NULL${includeArchived ? '' : ' AND s.archived = 0'}`;

    const like = tokens.map(() => `s.title LIKE ? ESCAPE '\\'`).join(' AND ');
    const esc = (t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const title = this.db.prepare(`
      SELECT s.id FROM sessions s WHERE ${visible} AND ${like}
      ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC LIMIT ?`).all(...tokens.map(esc), limit).map((r) => r.id);

    // Every token as a quoted prefix term (FTS syntax characters are neutralised by the quotes).
    // Prefix matching from 3 characters on; shorter prefixes match half the index and get slow.
    const match = `content : (${tokens.map((t) => `"${t}"${t.length >= 3 ? '*' : ''}`).join(' AND ')})`;
    let content = [];
    if (tokens.join('').length >= 2) try {
      // 1) rank hits, best one per session; 2) snippets only for those (snippet() is the expensive part).
      const rows = this.db.prepare(`
        SELECT m.session_id AS id, m.id AS msg_id, m.role, m.timestamp AS ts, h.score, substr(m.content, 1, 400) AS head, m.display_kind AS kind
        FROM (SELECT rowid, bm25(messages_fts) AS score FROM messages_fts WHERE messages_fts MATCH ? ORDER BY score LIMIT 800) h
        JOIN messages m ON m.id = h.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE m.role IN ('user','assistant') AND m.compacted = 0 AND ${visible}
        ORDER BY h.score`).all(match);
      const best = new Map();
      for (const r of rows) {
        const b = best.get(r.id);
        if (b) b.hits++; else best.set(r.id, { ...r, hits: 1 });
      }
      content = [...best.values()].slice(0, limit);
      if (content.length) {
        const snips = new Map(this.db.prepare(`
          SELECT rowid AS id, snippet(messages_fts, 0, char(2), char(3), '…', 16) AS snip FROM messages_fts
          WHERE messages_fts MATCH ? AND rowid IN (${content.map(() => '?').join(',')})`).all(match, ...content.map((c) => c.msg_id)).map((r) => [r.id, r.snip]));
        for (const c of content) c.snip = snips.get(c.msg_id) || '';
      }
    } catch { /* FTS unavailable or rebuilding: title hits only */ }
    return { title, content };
  }

  maxIds() {
    return this.db.prepare(`SELECT (SELECT COALESCE(max(id),0) FROM messages) AS msg,
      (SELECT COALESCE(max(COALESCE(last_activity_at, started_at)),0) FROM sessions) AS act`).get();
  }
}
