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
        EXISTS (SELECT 1 FROM session_admissions a WHERE a.target_session_id = s.id AND a.status IN ('queued','started')) AS admitted,
        EXISTS (SELECT 1 FROM session_turn_leases l WHERE l.conversation_id = s.id AND l.expires_at > unixepoch('subsec')) AS leased
      FROM sessions s WHERE s.id = ?`).get(id);
  }

  messages(id) {
    return this.db.prepare(`
      SELECT id, role, content, tool_calls, tool_name, tool_call_id, timestamp, display_kind
      FROM messages WHERE session_id = ? AND role IN ('user','assistant','tool') AND compacted = 0
      ORDER BY id`).all(id);
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

  maxIds() {
    return this.db.prepare(`SELECT (SELECT COALESCE(max(id),0) FROM messages) AS msg,
      (SELECT COALESCE(max(COALESCE(last_activity_at, started_at)),0) FROM sessions) AS act`).get();
  }
}
