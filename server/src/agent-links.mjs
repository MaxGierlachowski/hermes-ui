// Links between chats and Paseo agents beyond what the chat's own transcript shows (src/paseo-cli.mjs,
// scanPaseoRefs in server.mjs):
//   label      the agent carries a Hermes session id in one of SESSION_LABELS (set by whoever starts it:
//              a Hermes skill, a cron, a webhook). rel 'created'.
//   successor  the agent carries `predecessor=<id or unique prefix>` (a restart after a usage limit, often
//              from another Hermes run): it inherits every chat link of its predecessor, recursively, with
//              the predecessor's rel. Archived predecessors count too.
//   manual     attached by hand on the card (board.json `attached`). rel 'created'.
// Session ids are mapped to the root of their lineage (parent_session_id) by the caller's rootOf(), so a
// link to a continued or child session counts for the card the board shows. Pure: no I/O here.
// Contract: docs/features.md "Linking agents to chats".

export const SESSION_LABELS = ['origin_ref', 'hermes_chat_id', 'hermes_session_id'];
export const PREDECESSOR_LABEL = 'predecessor';
export const VIA_RANK = { manual: 4, label: 3, transcript: 2, successor: 1 };
const RANK = { created: 3, steers: 2, watches: 1 };

// A full agent id or a prefix of at least 6 hex characters (like `paseo ls` prints).
const AGENT_REF = /^[0-9a-f]{6}[0-9a-f-]{0,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Hermes session ids an agent's labels name (only ids isSession() knows). */
export function labelSessions(labels, isSession = () => true) {
  const out = new Set();
  for (const k of SESSION_LABELS) {
    const v = String(labels?.[k] ?? '').trim();
    if (v && v.length <= 200 && isSession(v)) out.add(v);
  }
  return [...out];
}

/** The predecessor ref of an agent (full id or prefix), lower-cased, or null. */
export function predecessorRef(labels) {
  const v = String(labels?.[PREDECESSOR_LABEL] ?? '').trim().toLowerCase();
  return AGENT_REF.test(v) ? v : null;
}

/** The one id among `ids` that is `ref` or starts with it; null when none or ambiguous. */
export function resolveRef(ref, ids) {
  if (!ref) return null;
  let hit = null;
  for (const id of ids) {
    if (id === ref) return id;
    if (!id.startsWith(ref)) continue;
    if (hit && hit !== id) return null;
    hit = id;
  }
  return hit || (UUID.test(ref) ? ref : null);
}

const better = (a, b) => !b || RANK[a.rel] > RANK[b.rel] || (RANK[a.rel] === RANK[b.rel] && VIA_RANK[a.via] > VIA_RANK[b.via]);

/**
 * Extra chat links of all agents (label, successor, manual), per root session.
 * @param {object} o
 * @param {Map<string, { labels?: object }>} o.agents  agents the daemon reported (live and loaded archived ones)
 * @param {(agentId: string) => { sessionId: string, rel: string }[]} o.direct  transcript links of one agent
 * @param {Record<string, Record<string, object>>} [o.manual]  sessionId -> agentId -> { at }
 * @param {(id: string) => boolean} [o.isSession]
 * @param {(id: string) => string} [o.rootOf]
 * @param {Iterable<string>} [o.knownIds]  more full agent ids for resolving predecessor prefixes
 * @returns {{ bySession: Map<string, Map<string, { rel: string, via: string, successorOf: string|null }>>, predecessors: Map<string, string>, missing: Set<string> }}
 *   predecessors: agent id -> resolved predecessor id; missing: predecessor ids not loaded yet (load them, then rebuild)
 */
export function extraLinks({ agents, direct, manual = {}, isSession = () => true, rootOf = (id) => id, knownIds = [], maxDepth = 20 }) {
  const ids = new Set([...agents.keys(), ...knownIds]);
  const manualOf = new Map(); // agentId -> [sessionId]
  for (const [sid, list] of Object.entries(manual)) for (const aid of Object.keys(list || {})) {
    if (!manualOf.has(aid)) manualOf.set(aid, []);
    manualOf.get(aid).push(sid);
  }
  const predecessors = new Map();
  const missing = new Set();
  const predOf = (id) => {
    if (predecessors.has(id)) return predecessors.get(id);
    const ref = predecessorRef(agents.get(id)?.labels);
    const p = ref ? resolveRef(ref, ids) : null;
    const pred = p && p !== id ? p : null;
    predecessors.set(id, pred);
    if (pred && !agents.has(pred)) missing.add(pred);
    return pred;
  };
  // Own links: label, manual, and (for predecessors) the transcript.
  const own = (id, withTranscript) => {
    const out = [];
    for (const sid of labelSessions(agents.get(id)?.labels, isSession)) out.push({ sessionId: rootOf(sid), rel: 'created', via: 'label' });
    for (const sid of manualOf.get(id) || []) out.push({ sessionId: rootOf(sid), rel: 'created', via: 'manual' });
    if (withTranscript) for (const l of direct(id)) out.push({ sessionId: rootOf(l.sessionId), rel: l.rel, via: 'transcript' });
    return out;
  };
  // Everything an agent is linked to, with what it inherits from its chain of predecessors.
  const all = (id) => {
    const out = own(id, false);
    const seen = new Set([id]);
    let cur = id;
    for (let depth = 0; depth < maxDepth; depth++) {
      const pred = predOf(cur);
      if (!pred || seen.has(pred)) break; // cycle guard
      seen.add(pred);
      for (const l of own(pred, true)) out.push({ ...l, via: 'successor', successorOf: predOf(id) });
      cur = pred;
    }
    return out;
  };
  const bySession = new Map();
  for (const id of new Set([...agents.keys(), ...manualOf.keys()])) {
    for (const l of all(id)) {
      const entry = { rel: l.rel, via: l.via, successorOf: l.successorOf ?? predOf(id) ?? null };
      if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, new Map());
      const m = bySession.get(l.sessionId);
      if (better(entry, m.get(id))) m.set(id, entry);
    }
  }
  return { bySession, predecessors, missing };
}

/**
 * The links one card shows: transcript links (rel, linkedAt) merged with the extra ones. A manual attach
 * always wins; otherwise the better rel. Agents detached by hand on this card are left out.
 * @param {Map<string, { rel: string, linkedAt: number|null }>} transcript
 * @param {Map<string, { rel: string, via: string }>|undefined} extra
 * @param {Record<string, object>} [detached]  agentId -> { at }
 * @returns {Map<string, { rel: string, linkedAt: number|null, via: string }>}
 */
export function mergeCardLinks(transcript, extra, detached = {}) {
  const out = new Map();
  for (const [id, l] of transcript) out.set(id, { rel: l.rel, linkedAt: l.linkedAt ?? null, via: 'transcript' });
  for (const [id, l] of extra || []) {
    const prev = out.get(id);
    if (prev && RANK[prev.rel] >= RANK[l.rel] && l.via !== 'manual') continue;
    out.set(id, { rel: l.rel, linkedAt: prev?.linkedAt ?? null, via: l.via });
  }
  for (const id of Object.keys(detached || {})) out.delete(id);
  return out;
}
