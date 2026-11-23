// Paseo agents a Hermes chat uses through the terminal instead of paseo-mcp: the `paseo` CLI
// (`paseo send <id> …`, `$P logs $ID` with P=…/paseo and ID=<uuid> set in the same command), and
// scripts that create an agent (`paseo run`, a Node client calling agents.create, paseo-mcp over stdio)
// and print the new id. Pure: commands and outputs in, refs out. The caller keeps only refs the Paseo
// daemon knows (paseo.resolve()), and an id from an output only when that agent was created during
// the call (see docs/decisions/0013-hermes-child-agents.md).

import { shellTokens } from './hermes-children.mjs';

const SEPARATORS = new Set([';', '&&', '||', '|', '&']);
const REDIRECTS = new Set(['>', '>>', '<', '2>', '2>>', '&>']);
const PREFIX_WORDS = new Set(['exec', 'nohup', 'env', 'command', 'time', '(', '{', 'then', 'do', 'else', 'if', 'while', 'until', '!', 'export']);
const GLOBAL_WITH_VALUE = new Set(['-o', '--format', '--host', '--home']);
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

// Subcommand -> how it ties the chat to the agent. run / import create one (id in the output).
const REL = {
  send: 'steers', run: 'steers', archive: 'steers', permit: 'steers', stop: 'steers', delete: 'steers', import: 'steers',
  logs: 'watches', inspect: 'watches', ls: 'watches', wait: 'watches', attach: 'watches', open: 'watches',
};
const CREATES = new Set(['run', 'import']);

// Full id or a prefix like `paseo ls` prints (resolved against the daemon later).
const REF = /^[0-9a-f]{6,8}(?:-[0-9a-f-]{0,28})?$/i;
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const expand = (t, vars) => t.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, n) => (vars.has(n) ? vars.get(n) : m));

// `$( … )` bodies inside one token (shellTokens keeps a substitution together with its word).
function substitutions(tok) {
  const out = [];
  for (let i = tok.indexOf('$('); i >= 0; i = tok.indexOf('$(', i + 2)) {
    let depth = 0;
    let j = i + 1;
    for (; j < tok.length; j++) { if (tok[j] === '(') depth++; else if (tok[j] === ')' && --depth === 0) break; }
    out.push(tok.slice(i + 2, j));
  }
  return out;
}

function scan(cmd, vars, out) {
  const tok = shellTokens(cmd);
  for (let i = 0; i < tok.length; i++) {
    for (const inner of substitutions(tok[i])) scan(inner, vars, out);
    // Command position: start, after a separator, or after assignments / exec / nohup / if / ….
    let k = i - 1;
    while (k >= 0 && (ASSIGN.test(tok[k]) || PREFIX_WORDS.has(tok[k]))) k--;
    if (k >= 0 && !SEPARATORS.has(tok[k])) continue;
    const a = tok[i].match(ASSIGN);
    if (a) { if (!a[2].includes('$(')) vars.set(a[1], expand(a[2], vars)); continue; }
    if (expand(tok[i], vars).split('/').pop() !== 'paseo') continue;
    let j = i + 1;
    const end = () => j >= tok.length || SEPARATORS.has(tok[j]);
    for (; !end(); j++) {
      if (GLOBAL_WITH_VALUE.has(tok[j])) { j++; continue; }
      if (!tok[j].startsWith('-')) break;
    }
    if (end()) continue;
    let sub = tok[j];
    if (sub === 'agent' && !SEPARATORS.has(tok[j + 1] ?? ';')) sub = tok[++j]; // `paseo agent logs <id>`
    if (!REL[sub]) continue;
    const call = { sub, rel: REL[sub], ref: null, creates: CREATES.has(sub) };
    for (j++; !end(); j++) {
      if (REDIRECTS.has(tok[j])) { j++; continue; }
      if (GLOBAL_WITH_VALUE.has(tok[j])) { j++; continue; }
      if (tok[j].startsWith('-')) continue;
      const v = expand(tok[j], vars);
      if (REF.test(v)) { call.ref = v.toLowerCase(); break; }
    }
    out.push(call);
  }
}

/**
 * Paseo CLI calls in one shell command.
 * @returns {{ sub: string, rel: 'steers'|'watches', ref: string|null, creates: boolean }[]}
 */
export function paseoCliCalls(cmd) {
  const out = [];
  scan(String(cmd || ''), new Map(), out);
  return out;
}

/**
 * What a terminal command does with Paseo agents: the refs it names (steers / watches), and whether it
 * may have created one whose id is then in the output (`paseo run`, a client calling agents.create,
 * paseo-mcp's create tool, or any script about Paseo that is not just `paseo ls`). sure: it creates
 * explicitly or names no agent of its own, so a single new id in its output is the one it created.
 */
export function paseoTerminal(cmd) {
  const s = String(cmd || '');
  const calls = paseoCliCalls(s);
  const refs = calls.filter((c) => c.ref).map(({ ref, rel }) => ({ ref, rel }));
  const onlyReads = calls.length > 0 && calls.every((c) => c.rel === 'watches') && !/agents\.create|create_agent/.test(s)
    && !/paseo[\w./-]*\.(?:m?js|py|sh)\b/i.test(s);
  const creates = calls.some((c) => c.creates) || (!onlyReads && /paseo|agents\.create|create_agent/i.test(s));
  const sure = calls.some((c) => c.creates) || /agents\.create|create_agent/.test(s) || !refs.length;
  return { refs, creates, sure, named: [...new Set([...refs.map((r) => r.ref), ...(s.match(UUID_G) || []).map((u) => u.toLowerCase())])] };
}

/**
 * Agent ids a terminal result prints that the command did not name itself (candidates for 'created').
 * @param {string} content  the tool row: {"output": …} JSON or plain text
 * @param {string[]} named  refs / ids the command named (prefixes too)
 */
export function outputIds(content, named = []) {
  let text = String(content || '');
  try { const b = JSON.parse(text); if (b && typeof b.output === 'string') text = b.output; } catch { /* plain text */ }
  const ids = [...new Set((text.match(UUID_G) || []).map((u) => u.toLowerCase()))];
  return ids.filter((id) => !named.some((n) => id.startsWith(n))).slice(0, 20);
}

// ---------- links (sessionId -> ref -> entry) ----------

export const REL_RANK = { created: 3, steers: 2, watches: 1 };

/**
 * One chat -> agent link, merged with what was known before. strict: only an id the daemon resolves
 * counts (CLI and output refs). window [from, to]: a 'created' read from an output holds only if the
 * agent was created in it; else the link falls back to orRel (what the chat did with it before).
 * single: when the creation time is unknown (paseo-mcp does not report one), the 'created' holds only
 * if the id was the one new id in the output of a command that creates or names no agent itself.
 * @param {{ rel: string, at: number, strict: boolean, window: number[]|null, single?: boolean, orRel: string|null }|undefined} prev
 */
export function mergeLink(prev, rel, at, { strict = false, window = null, single = false } = {}) {
  if (!prev) return { rel, at, strict, window, single: !!window && single, orRel: null };
  const s = prev.strict && strict;
  if (REL_RANK[rel] > REL_RANK[prev.rel]) {
    const base = prev.window ? prev.orRel : prev.rel;
    return { rel, at: prev.at, strict: s, window, single: !!window && single, orRel: window ? base : null };
  }
  if (!prev.window) return { ...prev, strict: s };
  if (rel === prev.rel) return window ? { ...prev, strict: s, single: prev.single || single } : { ...prev, strict: s, window: null, single: false, orRel: null }; // confirmed by a hard link
  const orRel = !prev.orRel || REL_RANK[rel] > REL_RANK[prev.orRel] ? rel : prev.orRel;
  return { ...prev, strict: s, orRel };
}

/** The rel a link stands for, given the agent's createdAt (ISO, may be unknown); null = not linked after all. */
export function linkRel(entry, createdAt) {
  if (!entry.window) return entry.rel;
  const c = Date.parse(createdAt || '') / 1000;
  const holds = Number.isFinite(c) ? c >= entry.window[0] && c <= entry.window[1] : !!entry.single;
  return holds ? entry.rel : entry.orRel || null;
}
