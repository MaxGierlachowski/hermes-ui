// Child agents a Hermes chat starts by itself, shown like Paseo agents (inline, in the agent list,
// and keeping the chat in Doing while they run). Two kinds:
//
// - subagent: `delegate_task`. Hermes writes every child as its own sessions row (source 'subagent',
//   parent_session_id = the chat, model_config._subagent_id). Background delegations return the
//   subagent ids in the tool result, so the link is a hard id. Synchronous ones ({"results": […]})
//   return none; their children are matched to the call by parent and start window, then by the task's
//   goal in the child's first message, else in task order.
// - terminal: `hermes [-p <profile>] chat -q …` run through the terminal tool. The child is a plain
//   'oneshot' session (in the profile's own state.db with -p) and Hermes records no parent for it, so
//   it is matched by start time right after the call and by its first prompt (match 'prompt' or
//   'time', i.e. heuristic; see docs/decisions/0013-hermes-child-agents.md). The process id and pid
//   come from the tool result, the exit code from Hermes' "process complete" notice.
//
// Everything here is pure (rows in, views out) so it can be tested without a database.

import { callsOf } from './paseo-calls.mjs';

// ---------- shell command → hermes runs ----------

// Tokens of a shell command, enough for `hermes … chat -q '…'`: quotes, escapes, $(…) kept as one
// token, and the separators ; && || | & and redirections as their own tokens.
export function shellTokens(cmd) {
  const s = String(cmd || '');
  const out = [];
  let cur = null;
  const push = () => { if (cur !== null) out.push(cur); cur = null; };
  const subst = (i) => { // index of the ')' closing the $( at i
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
    return j;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      cur = (cur ?? '') + s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j;
    } else if (c === '"') {
      let v = '';
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) v += s[++j];
        else if (s[j] === '$' && s[j + 1] === '(') { const e = subst(j); v += s.slice(j, e + 1); j = e; } else v += s[j];
      }
      cur = (cur ?? '') + v;
      i = j;
    } else if (c === '\\' && i + 1 < s.length) {
      cur = (cur ?? '') + s[++i];
    } else if (c === '$' && s[i + 1] === '(') {
      const e = subst(i);
      cur = (cur ?? '') + s.slice(i, e + 1);
      i = e;
    } else if (/\s/.test(c)) {
      push();
    } else if (';&|<>'.includes(c)) {
      // `2>` / `2>>`: the digit belongs to the redirection, not to the word before.
      if (c === '>' && cur === '2') { cur = null; if (s[i + 1] === '>') { i++; out.push('2>>'); } else out.push('2>'); continue; }
      push();
      const two = s.slice(i, i + 2);
      if (['&&', '||', '>>', '&>'].includes(two)) { out.push(two); i++; } else out.push(c);
    } else {
      cur = (cur ?? '') + c;
    }
  }
  push();
  return out;
}

const SEPARATORS = new Set([';', '&&', '||', '|', '&']);
const REDIRECTS = new Set(['>', '>>', '<', '2>', '2>>', '&>']);
// Global options of the hermes CLI that take a value (before the subcommand).
const GLOBAL_WITH_VALUE = new Set(['-p', '--profile', '--home', '--config']);
const PREFIX_WORDS = new Set(['exec', 'nohup', 'env', 'command', 'time', '(', '{', 'then', 'do', 'else']);

/**
 * Every `hermes … chat` run in a shell command. Only runs that will write a session count: a chat with
 * a query (-q / --query / --query-file); a bare interactive `hermes chat` cannot run in the tool.
 * @returns {{ profile: string|null, query: string|null, queryFile: string|null, source: string|null }[]}
 */
export function hermesRuns(cmd) {
  const tok = shellTokens(cmd);
  const runs = [];
  for (let i = 0; i < tok.length; i++) {
    if (tok[i].split('/').pop() !== 'hermes') continue;
    // Command position: start, after a separator, or after env assignments / exec / nohup / ….
    let k = i - 1;
    while (k >= 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok[k]) || PREFIX_WORDS.has(tok[k]))) k--;
    if (k >= 0 && !SEPARATORS.has(tok[k])) continue;
    let profile = null;
    let j = i + 1;
    for (; j < tok.length && !SEPARATORS.has(tok[j]); j++) {
      const t = tok[j];
      if (t === 'chat') break;
      const eq = t.match(/^(--profile|-p)=(.*)$/);
      if (eq) { profile = eq[2]; continue; }
      if (GLOBAL_WITH_VALUE.has(t)) { if (t === '-p' || t === '--profile') profile = tok[j + 1] ?? null; j++; continue; }
      if (!t.startsWith('-')) { j = tok.length; break; } // another subcommand (gateway, config, …)
    }
    if (tok[j] !== 'chat') continue;
    let query = null;
    let queryFile = null;
    let source = null;
    for (let m = j + 1; m < tok.length && !SEPARATORS.has(tok[m]); m++) {
      const t = tok[m];
      if (REDIRECTS.has(t)) { m++; continue; }
      const eq = t.match(/^(--query|--query-file|--source|-q)=([\s\S]*)$/);
      const [flag, val] = eq ? [eq[1], eq[2]] : [t, tok[m + 1]];
      const take = () => { if (!eq) m++; return val ?? null; };
      if (flag === '-q' || flag === '--query') query = take();
      else if (flag === '--query-file') queryFile = take();
      else if (flag === '--source') source = take();
    }
    if (query == null && queryFile == null) continue;
    runs.push({ profile: profile && profile !== 'default' ? profile : null, query, queryFile, source });
  }
  return runs;
}

// `-q "$(cat /path/prompt.md)"` names the prompt file instead of the prompt.
export const promptFileOf = (query) => String(query || '').match(/^\$\(\s*cat\s+(?:--\s+)?['"]?([^'"()\s]+)['"]?\s*\)$/)?.[1] || null;

// ---------- the parent's transcript → child calls ----------

const parseJson = (s) => {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || 'null'); } catch { return null; }
};
const clipText = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Child calls in one parent transcript, in order.
 * @param {{ id: number, role: string, tool_calls?: string, tool_name?: string, tool_call_id?: string, content?: string, timestamp: number, display_kind?: string }[]} rows
 *   the parent's assistant rows with tool calls, its delegate_task / terminal tool rows and its
 *   process_complete notices (store.childRows()).
 * @returns {object[]} subagent tasks and hermes terminal runs, each with msgId (the assistant row that
 *   started it), callId, index (within the call), ts and what the result and notices said.
 */
export function childCalls(rows) {
  const out = [];
  const byCall = new Map(); // tool_call_id -> [call, …] (one tool call may start several children)
  const results = new Map(); // tool_call_id -> tool row
  const procDone = new Map(); // proc_… -> { exitCode, ts, killed }
  for (const r of rows) {
    if (r.role === 'tool' && r.tool_call_id) results.set(r.tool_call_id, r);
    if (r.role === 'user' && r.display_kind === 'process_complete') {
      const text = String(r.content || '');
      const m = text.match(/(proc_[0-9a-zA-Z]+)[\s\S]{0,200}?exit code (-?\d+)/i);
      const p = m || text.match(/(proc_[0-9a-zA-Z]+)/);
      if (p) procDone.set(p[1], { exitCode: m ? Number(m[2]) : null, ts: r.timestamp, killed: /killed|terminated|timed? ?out/i.test(text.slice(0, 300)) });
    }
  }
  for (const r of rows) {
    if (r.role !== 'assistant' || !r.tool_calls) continue;
    for (const [callId, list] of callsOf(r.tool_calls)) {
      for (const { name, args } of list) {
        const short = String(name || '').split('__').pop();
        let started = [];
        if (short === 'delegate_task') {
          // steer / list / status calls carry an action and start nothing.
          if (args.action && !['start', 'dispatch', 'run'].includes(args.action)) continue;
          const tasks = Array.isArray(args.tasks) && args.tasks.length ? args.tasks : (args.goal ? [{ goal: args.goal }] : []);
          started = tasks.map((task) => ({ kind: 'subagent', goal: clipText(task?.goal || task?.task || '', 400) || null }));
        } else if (short === 'terminal') {
          started = hermesRuns(args.command).map((run) => ({ kind: 'terminal', command: clipText(args.command, 600), background: !!args.background, ...run }));
        }
        const prev = byCall.get(callId) || [];
        started.forEach((s, i) => {
          const c = { ...s, msgId: r.id, callId, ts: r.timestamp, index: prev.length + i };
          out.push(c);
          prev.push(c);
        });
        if (prev.length) byCall.set(callId, prev);
      }
    }
  }
  for (const [callId, list] of byCall) {
    const res = results.get(callId);
    if (!res) continue;
    const body = parseJson(res.content);
    for (const c of list) {
      c.resultTs = res.timestamp;
      if (c.kind === 'subagent') {
        if (Array.isArray(body?.subagent_ids)) {
          c.subagentId = body.subagent_ids[c.index] || null;
          c.delegationId = body.delegation_id || null;
          c.background = true;
        } else if (Array.isArray(body?.results)) {
          const r = body.results.find((x) => x?.task_index === c.index) || body.results[c.index];
          c.taskStatus = r?.status || null;
          c.background = false;
        } else {
          c.failed = clipText(res.content, 300); // refused or failed before it started a child
        }
      } else {
        c.procId = typeof body?.session_id === 'string' && body.session_id.startsWith('proc_') ? body.session_id : null;
        c.pid = Number.isInteger(body?.pid) ? body.pid : null;
        // A foreground run is over when its result is there; a background one when its notice arrives.
        if (!c.procId) c.exitCode = Number.isInteger(body?.exit_code) ? body.exit_code : (body?.error ? 1 : 0);
        if (c.procId && procDone.has(c.procId)) {
          const d = procDone.get(c.procId);
          c.exitCode = d.exitCode ?? 0;
          c.doneTs = d.ts;
          c.killed = d.killed;
        }
      }
    }
  }
  return out;
}

// ---------- matching ----------

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Subagent sessions for the chat's delegate_task calls. Background calls: by subagent id (hard).
 * Synchronous calls: the chat's subagent rows without an id match that started between call and
 * result; within one call by the task's goal in the child's first message, else in start order.
 * @param {object[]} calls  from childCalls(), kind 'subagent'
 * @param {{ id: string, subagent_id?: string, started_at: number, first_prompt?: string }[]} sessions  the chat's subagent rows
 * @returns {Map<object, object[]>} call -> its session segments (oldest first; compression continues a child in a new row)
 */
export function matchSubagents(calls, sessions) {
  const out = new Map();
  const bySa = new Map();
  for (const s of [...sessions].sort((a, b) => a.started_at - b.started_at)) {
    const k = s.subagent_id || `:${s.id}`;
    bySa.set(k, [...(bySa.get(k) || []), s]);
  }
  const used = new Set();
  for (const c of calls) {
    if (c.subagentId && bySa.has(c.subagentId)) { out.set(c, bySa.get(c.subagentId)); used.add(c.subagentId); c.match = 'id'; }
  }
  const groups = new Map();
  for (const c of calls) if (!out.has(c) && !c.subagentId && !c.failed) groups.set(c.callId, [...(groups.get(c.callId) || []), c]);
  for (const list of groups.values()) {
    const from = list[0].ts - 2;
    const to = (list[0].resultTs ?? Infinity) + 2;
    const cand = [...bySa.entries()].filter(([k, segs]) => !used.has(k) && segs[0].started_at >= from && segs[0].started_at <= to);
    const claim = (c, hit) => { used.add(hit[0]); out.set(c, hit[1]); };
    // 1) the goal appears in the child's first message (Hermes hands it the goal as its task)
    for (const c of list) {
      const goal = norm(c.goal).replace(/…$/, '').slice(0, 120);
      if (goal.length < 12) continue;
      const hit = cand.find(([k, segs]) => !used.has(k) && norm(segs[0].first_prompt).includes(goal));
      if (hit) { claim(c, hit); c.match = 'goal'; }
    }
    // 2) the rest in task order
    const rest = cand.filter(([k]) => !used.has(k));
    list.filter((c) => !out.has(c)).sort((a, b) => a.index - b.index).forEach((c, i) => {
      if (!rest[i]) return;
      claim(c, rest[i]);
      c.match = 'order';
    });
  }
  return out;
}

/**
 * The session a terminal `hermes chat` run wrote, among the candidates of its database.
 * Prompt equality wins, a prompt prefix next; otherwise the one oneshot that started within a minute
 * after the call (only when exactly one did, so two parallel runs are never swapped silently).
 * @param {object} call  from childCalls(), kind 'terminal'
 * @param {{ id: string, started_at: number, source: string, created_source?: string, first_prompt?: string }[]} candidates
 * @param {Set<string>} taken  session ids already matched to another call
 * @param {string|null} promptText  the prompt file's content when the call used `-q "$(cat file)"` / --query-file
 * @returns {{ session: object, match: 'prompt'|'time' }|null}
 */
export function matchTerminal(call, candidates, taken = new Set(), promptText = null) {
  const want = norm(promptText ?? (promptFileOf(call.query) ? null : call.query));
  const from = call.ts - 2;
  const to = Math.max((call.doneTs ?? call.resultTs ?? call.ts) + 600, call.ts + 120); // a background run may wait for a slot
  const pool = candidates.filter((s) => !taken.has(s.id) && s.started_at >= from && s.started_at <= to
    && (!call.source || s.source === call.source || s.created_source === call.source));
  if (want) {
    const exact = pool.find((s) => norm(s.first_prompt) === want);
    if (exact) return { session: exact, match: 'prompt' };
    const head = want.slice(0, 200);
    const prefix = pool.find((s) => head.length >= 20 && norm(s.first_prompt).startsWith(head));
    if (prefix) return { session: prefix, match: 'prompt' };
  }
  // Time only (also when a prompt was given but the first message differs: Hermes may wrap or trim it).
  const near = pool.filter((s) => s.started_at <= call.ts + 60 && (s.source === 'oneshot' || (call.source && s.source === call.source)));
  return near.length === 1 ? { session: near[0], match: 'time' } : null;
}

// ---------- state ----------

const ERROR_END = /error|fail|crash|exception|timeout|killed|abort/i;
const STALE_S = 6 * 3600;

/**
 * State of a subagent from its session rows and its delegation record. Never guessed from time alone:
 * an open row counts as running while its delegation is not finished; an open row without a
 * delegation record that has not moved for hours is 'unknown'.
 */
export function subagentState({ call, segments = [], delegation = null, now = Date.now() / 1000 }) {
  const tip = segments.at(-1);
  if (call.failed && !tip) return 'error';
  if (tip?.ended_at) return ERROR_END.test(tip.end_reason || '') || /fail|error/i.test(call.taskStatus || '') ? 'error' : 'finished';
  if (delegation?.state === 'error') return 'error';
  if (delegation?.state === 'completed') return 'finished';
  if (call.taskStatus) return /fail|error/i.test(call.taskStatus) ? 'error' : 'finished';
  if (!call.background && call.resultTs) return 'finished';
  // Dispatched, row not written yet: running for a while, then nothing proves it any more.
  if (!tip) return now - call.ts < 3600 ? 'running' : 'unknown';
  if (!delegation && now - (tip.last_activity_at || tip.started_at) > STALE_S) return 'unknown';
  return 'running';
}

/**
 * State of a terminal `hermes chat` run: exit code from the result / completion notice, else the
 * child session (ended_at), else whether its process is alive (pid from the tool result).
 */
export function terminalState({ call, session = null, pidAlive = null, now = Date.now() / 1000 }) {
  if (call.exitCode != null) return call.exitCode === 0 && !call.killed ? 'finished' : 'error';
  if (session?.ended_at) return ERROR_END.test(session.end_reason || '') ? 'error' : 'finished';
  if (call.pid && pidAlive === false) return session ? 'unknown' : 'error';
  if (call.pid && pidAlive === true) return 'running';
  // Foreground call still in progress (no result yet), or a background call whose result is not written.
  if (!call.resultTs) return now - call.ts < 3 * 3600 ? 'running' : 'unknown';
  if (session && now - (session.last_activity_at || session.started_at) < STALE_S) return 'running';
  return 'unknown';
}

// ---------- views ----------

export const childId = (c, sessionId, profile) => `hermes:${profile || 'default'}:${sessionId || c.subagentId || c.procId || `${c.callId}.${c.index}`}`;

/** Parses an id from childId(): profile (null = the main db) and the session id (or a placeholder). */
export function parseChildId(id) {
  const m = String(id || '').match(/^hermes:([A-Za-z0-9_.-]+):(.+)$/);
  return m ? { profile: m[1] === 'default' ? null : m[1], ref: m[2] } : null;
}

/** Agent view, the same shape as a Paseo agent's (shared/types.ts PaseoAgent) with provider 'hermes'. */
export function childView(c, { session = null, state, profile = null }) {
  const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
  const file = c.queryFile || promptFileOf(c.query);
  const title = c.kind === 'subagent'
    ? clipText(session?.title && !/^Subagent:\s*CONTEXT/i.test(session.title) ? session.title.replace(/^Subagent:\s*/, '') : c.goal || 'Subagent', 120)
    : clipText(session?.title || (file ? `hermes chat · ${file.split('/').pop()}` : c.query) || 'hermes chat', 120);
  return {
    id: childId(c, session?.id, profile),
    provider: 'hermes',
    known: true,
    title,
    status: state,
    state,
    rel: 'created',
    account: profile,
    kind: c.kind,
    archived: false,
    pendingCount: 0,
    pendingPermissions: [],
    // id: hard link · goal / order: delegate_task parent link + task · prompt / time: heuristic (terminal)
    match: c.match || null,
    sessionId: session?.id || null,
    profile,
    goal: c.kind === 'subagent' ? c.goal : clipText(c.query && !promptFileOf(c.query) ? c.query : file || '', 400) || null,
    command: c.kind === 'terminal' ? c.command : null,
    model: session?.model || null,
    lastError: state === 'error' ? (c.failed || (c.exitCode != null ? `exit code ${c.exitCode}` : session?.end_reason || null)) : null,
    createdAt: iso(session?.started_at || c.ts),
    updatedAt: iso(session?.ended_at || session?.last_activity_at || c.doneTs || c.resultTs || c.ts),
    deepLink: null,
  };
}

/** Transcript items (shared/types.ts PaseoItem) from a child session's messages. */
export function childTimeline(rows) {
  const items = [];
  const open = new Map(); // tool_call_id -> item waiting for its result
  for (const r of rows) {
    if (r.role === 'user') items.push({ role: 'user', text: String(r.content || ''), ts: r.timestamp });
    else if (r.role === 'assistant') {
      if (String(r.content || '').trim()) items.push({ role: 'assistant', text: String(r.content), ts: r.timestamp });
      for (const [callId, list] of callsOf(r.tool_calls)) {
        for (const { name, args } of list) {
          const summary = args.command || args.goal || args.path || args.query || args.url || Object.values(args).find((v) => typeof v === 'string') || '';
          const it = { role: 'tool', toolName: name, status: 'running', summary: clipText(summary, 160), text: '', ts: r.timestamp };
          items.push(it);
          if (!open.has(callId)) open.set(callId, it);
        }
      }
    } else if (r.role === 'tool') {
      // The result belongs to its call above: shown with it, not as an item of its own.
      const it = open.get(r.tool_call_id);
      if (it) { it.status = 'completed'; it.text = clipText(r.content, 4000); open.delete(r.tool_call_id); } else items.push({ role: 'tool', toolName: r.tool_name || 'tool', status: 'completed', text: clipText(r.content, 4000), ts: r.timestamp });
    }
  }
  return items;
}
