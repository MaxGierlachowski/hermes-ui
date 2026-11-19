// Hermes' own child agents per chat (delegate_task subagents and terminal `hermes chat` runs), read
// from state.db and the profiles' state.db files, read-only. The parsing and matching rules live in
// hermes-children.mjs; this class adds the databases, the process check and a cache.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.mjs';
import { childCalls, childTimeline, childView, matchSubagents, matchTerminal, parseChildId, promptFileOf, subagentState, terminalState } from './hermes-children.mjs';

const PROFILE_RE = /^[A-Za-z0-9_.-]+$/;

/** Whether a process is alive (signal 0 only checks; it sends nothing). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM' ? true : false; }
}

export class HermesAgents {
  /** @param {{ store: Store, hermesHome: string, isAlive?: (pid: number) => boolean|null, now?: () => number }} o */
  constructor({ store, hermesHome, isAlive = pidAlive, now = () => Date.now() / 1000 }) {
    this.store = store;
    this.hermesHome = hermesHome;
    this.isAlive = isAlive;
    this.now = now;
    this.parents = new Set(); // chats that started children
    this.scanned = 0;
    this.cache = new Map(); // chat id -> { mark, calls }
    this.childOf = new Map(); // child session id -> chat id (for pushing the chat when a child changes)
    this.index = new Map(); // agent id -> { parent, profile, sessionId }
    this.stores = new Map(); // profile -> Store | null
  }

  /** Profile database (read-only), or the main one for null / 'default'. Null when it does not exist. */
  storeFor(profile) {
    if (!profile || profile === 'default') return this.store;
    if (!PROFILE_RE.test(profile)) return null;
    if (!this.stores.has(profile)) {
      const p = path.join(this.hermesHome, 'profiles', profile, 'state.db');
      let s = null;
      try { if (fs.existsSync(p)) s = new Store(p); } catch { s = null; }
      this.stores.set(profile, s);
    }
    return this.stores.get(profile);
  }

  /** Incremental scan of new messages; returns the chats whose children may have changed. */
  scan() {
    const touched = new Set();
    const max = this.store.maxIds().msg;
    for (const sid of this.store.childRefs(this.scanned)) { this.parents.add(sid); touched.add(sid); this.cache.delete(sid); }
    this.scanned = max;
    return touched;
  }

  /** The chat a changed session belongs to as a child (subagent rows name it; terminal runs are learnt). */
  parentOf(sessionId) {
    if (this.childOf.has(sessionId)) return this.childOf.get(sessionId);
    return null;
  }

  // Prompt file of `-q "$(cat …)"` / --query-file, only absolute or ~ paths, small text files, read-only.
  readPrompt(call) {
    const f = call.queryFile || promptFileOf(call.query);
    if (!f) return null;
    const abs = f.startsWith('~/') ? path.join(os.homedir(), f.slice(2)) : f;
    if (!path.isAbsolute(abs)) return null;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 512 * 1024) return null;
      return fs.readFileSync(abs, 'utf8');
    } catch { return null; }
  }

  /** Agent views of one chat, the same shape as Paseo agents (provider 'hermes'). */
  agentsFor(chatId) {
    if (!this.parents.has(chatId)) return [];
    const row = this.store.sessionBrief(chatId);
    const mark = `${row?.last_activity_at ?? ''}|${row?.message_count ?? ''}`;
    let entry = this.cache.get(chatId);
    if (!entry || entry.mark !== mark) {
      entry = { mark, calls: childCalls(this.store.childRows(chatId)), prompts: new Map() };
      this.cache.set(chatId, entry);
    }
    const now = this.now();
    const out = [];
    const subs = entry.calls.filter((c) => c.kind === 'subagent');
    if (subs.length) {
      const segs = matchSubagents(subs, this.store.subagentSessions(chatId));
      const dels = new Map(this.store.delegations([...new Set(subs.map((c) => c.delegationId).filter(Boolean))]).map((d) => [d.delegation_id, d]));
      for (const c of subs) {
        const segments = segs.get(c) || [];
        const tip = segments.at(-1) || null;
        const state = subagentState({ call: c, segments, delegation: dels.get(c.delegationId) || null, now });
        const v = childView(c, { session: tip ? { ...tip, title: segments[0].title || tip.title } : null, state });
        for (const s of segments) this.childOf.set(s.id, chatId);
        this.index.set(v.id, { parent: chatId, profile: null, sessionId: tip?.id || null, segments: segments.map((s) => s.id) });
        out.push({ ...v, linkedAt: c.ts, msgId: c.msgId, callId: c.callId, index: c.index });
      }
    }
    const taken = new Map(); // profile -> Set(session ids)
    for (const c of entry.calls.filter((x) => x.kind === 'terminal')) {
      const db = this.storeFor(c.profile);
      let hit = null;
      if (db) {
        const t = taken.get(c.profile || '') || new Set();
        taken.set(c.profile || '', t);
        if (!entry.prompts.has(c)) entry.prompts.set(c, this.readPrompt(c));
        const cand = db.sessionsStartedBetween(c.ts - 2, Math.max((c.doneTs ?? c.resultTs ?? c.ts) + 600, c.ts + 120));
        hit = matchTerminal(c, cand, t, entry.prompts.get(c));
        if (hit) { t.add(hit.session.id); c.match = hit.match; }
      }
      const session = hit?.session || null;
      const state = terminalState({ call: c, session, pidAlive: c.pid && c.exitCode == null ? this.isAlive(c.pid) : null, now });
      const v = childView(c, { session, state, profile: c.profile });
      if (session && !c.profile) this.childOf.set(session.id, chatId);
      this.index.set(v.id, { parent: chatId, profile: c.profile, sessionId: session?.id || null, segments: session ? [session.id] : [] });
      out.push({ ...v, linkedAt: c.ts, msgId: c.msgId, callId: c.callId, index: c.index });
    }
    return out;
  }

  /** Transcript of one child agent (PaseoItem shape). */
  timeline(id, limit = 150) {
    let known = this.index.get(id);
    if (!known) {
      const p = parseChildId(id);
      if (!p) return null;
      known = { profile: p.profile, sessionId: p.ref, segments: [p.ref] };
    }
    const db = this.storeFor(known.profile);
    const rows = [];
    if (db) for (const sid of known.segments || []) if (db.sessionBrief(sid)) rows.push(...db.messages(sid));
    const items = childTimeline(rows);
    return { items: items.slice(-limit), hasOlder: items.length > limit, source: 'hermes' };
  }
}
