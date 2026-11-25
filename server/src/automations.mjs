// Automations in the inbox: cron runs and webhook runs that reported something (not silent, not
// suppressed). Read-only on Hermes' side, see docs/decisions/0014-automations-in-the-inbox.md:
//  - cron:    the run archive Hermes writes for every run of every job, whatever its `deliver` target
//             ($HERMES_HOME/cron/output/<job_id>/<timestamp>.md). Its header (**Status:**) and the
//             length-framed response decide: silent / ok / error. Agent runs link to their session.
//  - webhook: webhook sessions in state.db that ended with a final assistant reply.
// "Silent" is Hermes' own rule for autonomous lanes ([SILENT] and its documented variants), ported
// from gateway/response_filters.py (is_autonomous_silence_response); nothing else in the text counts.
// Idempotent across restarts: a cursor in <data-dir>/automations.json, ids derived from the run
// (file name, session id). The first start begins at "now" (optionally N hours back).

import fs from 'node:fs';
import path from 'node:path';
import { titleOf } from './user-markers.mjs';
import { previewText } from './notify.mjs';

// ---------- silence: Hermes' autonomous-lane matcher ----------
// LIVE_GATEWAY_SILENT_MARKERS (gateway/response_filters.py), including the translated forms Hermes ships.
const MARKERS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY', '[静默]', '静默', '[沉默]', '沉默', '[审核]', '审核']);
const BRACKETED = [...MARKERS].filter((m) => m.startsWith('[')).sort();
const MARKER_CAP = 64;
const stripCf = (s) => s.replace(/\p{Cf}/gu, '');
const canon = (s) => stripCf(s).trim().toUpperCase().split(/\s+/).filter(Boolean).join(' ').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');
const edgePunct = (ch) => ch !== '[' && ch !== ']' && /\p{P}/u.test(ch);
function stripEdgePunct(text) {
  const cs = Array.from(text);
  let a = 0;
  let b = cs.length;
  while (a < b && edgePunct(cs[a])) a++;
  while (b > a && edgePunct(cs[b - 1])) b--;
  return cs.slice(a, b).join('').trim();
}
function intentional(text) {
  if (typeof text !== 'string') return false;
  const s = text.trim();
  if (!s || s.length > MARKER_CAP) return false;
  const d = stripEdgePunct(s);
  return (d === s ? [s] : [s, d]).some((f) => MARKERS.has(canon(f)));
}
function stripCodeWrap(text) {
  let t = text.trim();
  if (t.startsWith('```') && t.endsWith('```') && t.length >= 6) {
    let inner = t.slice(3, -3);
    if (inner.includes('\n')) inner = inner.slice(inner.indexOf('\n') + 1);
    t = inner.trim();
  }
  while (t.length >= 2 && t[0] === '`' && t[t.length - 1] === '`') t = t.replace(/^`+|`+$/g, '').trim();
  return t;
}
function stripLeadingCodeSpan(text) {
  if (!text.startsWith('`')) return text;
  const run = text.length - text.replace(/^`+/, '').length;
  const close = text.indexOf('`'.repeat(run), run);
  return close !== -1 && !text.slice(run, close).includes('\n') ? text.slice(run, close).trim() : text;
}
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs = [...a].map((x, i) => (x !== b[i] ? i : -1)).filter((i) => i >= 0);
    return diffs.length <= 1 || (diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}
function damagedMarker(text) {
  const form = stripEdgePunct(stripCodeWrap(stripCf(text).normalize('NFKC').toLowerCase()));
  if (form.length > MARKER_CAP) return false;
  const m = form.match(/^\[\s*([^\s[\]]*)\s*(\]?)$/u);
  if (!m) return false;
  const [, letters, closed] = m;
  return (!closed && 'silent'.startsWith(letters)) || withinOneEdit(letters, 'silent');
}

/** True when a cron/webhook reply is Hermes' "nothing to report" sentinel (never delivered by Hermes either). */
export function isSilence(response) {
  const stripped = typeof response === 'string' ? stripCf(response).trim() : '';
  if (!stripped) return false;
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim());
  const candidates = [stripped, lines[0], lines[lines.length - 1]];
  return BRACKETED.some((m) => canon(stripLeadingCodeSpan(stripped)).startsWith(m))
    || damagedMarker(stripped)
    || candidates.some((c) => intentional(c) || intentional(stripCodeWrap(c)));
}

// ---------- the cron run archive ----------
const PROMPT_FRAME_RE = /^\*\*Prompt Characters:\*\* (\d+)\n## Prompt\n\n/m;
const RESPONSE_FRAME_RE = /^\*\*Response Characters:\*\* (\d+)\n## Response\n\n/;
const CRON_FAILURE = '[CRON_FAILURE]';
const NO_RESPONSE = '(No response generated)';

// Hermes counts characters in code points; JS strings count UTF-16 units. Only matters with astral characters.
const cpIndex = (s, from, n) => {
  if (!/[\uD800-\uDFFF]/.test(s)) return from + n;
  let i = from;
  for (let k = 0; k < n && i < s.length; k++) i += s.codePointAt(i) > 0xffff ? 2 : 1;
  return i;
};
const cpLength = (s) => (/[\uD800-\uDFFF]/.test(s) ? Array.from(s).length : s.length);

/** The framed response starting at `at` when its length frame matches the rest of the document, else null. */
function framedTail(doc, at) {
  const rf = doc.slice(at).match(RESPONSE_FRAME_RE);
  if (!rf || rf.index !== 0) return null;
  const tail = doc.slice(at + rf[0].length);
  return cpLength(tail) === Number(rf[1]) + 1 && tail.endsWith('\n') ? tail.slice(0, -1).trim() : null;
}

/**
 * The response of an agent run (Hermes' _archive_answer without the silence step); null when the frame is broken.
 * Hermes jumps over the prompt by its stamped length. That stamp is often off (the stamped prompt is not the
 * written one), so when the jump misses, the response frame is found from the end instead: the response is
 * the last section and its own length frame has to cover exactly the rest of the document.
 */
function archiveResponse(doc) {
  const pf = doc.match(PROMPT_FRAME_RE);
  if (pf && doc.indexOf('## Prompt\n\n') === pf.index + pf[0].length - '## Prompt\n\n'.length) {
    const jumped = framedTail(doc, cpIndex(doc, pf.index + pf[0].length, Number(pf[1])) + 2); // + the blank line after the prompt
    if (jumped != null) return jumped;
    for (let at = doc.lastIndexOf('\n**Response Characters:** '); at > pf.index; at = doc.lastIndexOf('\n**Response Characters:** ', at - 1)) {
      const found = framedTail(doc, at + 1);
      if (found != null) return found;
    }
    return null;
  }
  const at = doc.lastIndexOf('## Response');
  return at === -1 ? null : doc.slice(at + '## Response'.length).trim();
}

/**
 * Classifies one run archive. Returns
 *   { status: 'silent'|'ok'|'error', jobId, jobName, mode: 'agent'|'script'|'monitor'|null, title, body }
 * Hermes' formats: cron/scheduler.py (_run_doc_header, _run_no_agent_job, _apply_monitor_gate, the
 * preflight / injection / unrunnable blocks) and cron/scheduler_prompt.py (length frames).
 */
export function classifyRun(doc) {
  doc = String(doc ?? '');
  // A one-shot job Hermes dropped because its run time had passed (cron/jobs_oneshot_diagnostics.py).
  const dropped = doc.match(/^# (Cron job removed before firing[^\n]*)\n/);
  if (dropped) {
    const jobId = doc.match(/^- job id: (\S+)/m)?.[1] || null;
    return { jobId, jobName: doc.match(/^- name: (.+)$/m)?.[1]?.trim() || '', mode: null, status: 'error', title: dropped[1], body: doc.slice(dropped[0].length).trim() };
  }
  const heading = doc.match(/^# Cron Job: (.+)$/m)?.[1]?.trim() || '';
  const failedTitle = / \(FAILED\)$/.test(heading);
  const jobName = heading.replace(/ \(FAILED\)$/, '');
  const jobId = doc.match(/^\*\*Job ID:\*\* (\S+)/m)?.[1] || null;
  const modeLine = doc.match(/^\*\*Mode:\*\* (.+)$/m)?.[1] || '';
  const mode = /no_agent/.test(modeLine) ? 'script' : /monitor/.test(modeLine) ? 'monitor' : doc.includes('\n## Prompt') ? 'agent' : null;
  const base = { jobId, jobName, mode };
  // The run header ends where the prompt or the script output starts; only it describes suppression.
  const head = doc.split('\n---\n')[0].split('\n## Prompt')[0];
  if (/^Script gate returned `wakeAgent=false`/m.test(head)) return { ...base, status: 'silent', title: '', body: '' };
  const status = head.match(/^\*\*Status:\*\* (.+)$/m)?.[1]?.trim();
  if (status) {
    if (/^(silent|no_change)\b/i.test(status)) return { ...base, status: 'silent', title: '', body: '' };
    const body = head.slice(head.indexOf(status) + status.length).trim();
    return { ...base, status: 'error', title: status, body };
  }
  if (failedTitle) { // run_job's except branch: header + format_run_error()
    const err = doc.lastIndexOf('\n## Error\n');
    if (err !== -1) {
      const body = doc.slice(err + 1).trim();
      // The traceback's last line names the exception.
      const last = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('```') && l !== '## Error').pop();
      return { ...base, status: 'error', title: last ? `Run failed: ${last}` : 'Run failed', body };
    }
  }
  if (mode === 'agent') {
    const answer = archiveResponse(doc);
    if (answer == null) return { ...base, status: 'error', title: 'Run archive unreadable', body: '' };
    if (!answer || answer === NO_RESPONSE) return { ...base, status: 'error', title: 'No response', body: '' };
    const lines = answer.split('\n');
    if (lines[0].trimEnd() === CRON_FAILURE) {
      const evidence = lines.slice(1).join('\n').trim() || 'Cron agent reported failure.';
      return { ...base, status: 'error', title: titleOf(evidence) || 'Run failed', body: evidence };
    }
    if (isSilence(answer)) return { ...base, status: 'silent', title: '', body: '' };
    return { ...base, status: 'ok', title: titleOf(answer), body: answer };
  }
  // Short failure documents without a header block: "# Cron Job: x (FAILED)\n\n<error>", "# Cron Job: x\n\nError: …".
  const afterHeading = heading ? doc.slice(doc.indexOf(heading) + heading.length).trim() : doc.trim();
  if (failedTitle || /^Error: /.test(afterHeading)) return { ...base, status: 'error', title: 'Run failed', body: afterHeading };
  // Script (no_agent) output: everything after the header separator.
  const sep = doc.indexOf('\n---\n');
  const out = (sep === -1 ? afterHeading : doc.slice(sep + 5)).trim();
  if (!out || isSilence(out)) return { ...base, status: 'silent', title: '', body: '' };
  return { ...base, status: 'ok', title: titleOf(out), body: out };
}

// ---------- the watcher ----------
const BODY_MAX = 8000;
const LOOKBACK = 600; // seconds
const TEXT_MAX = 300;
const clipBody = (s) => (s.length > BODY_MAX ? `${s.slice(0, BODY_MAX - 1)}…` : s);
const oneLine = (s, n = TEXT_MAX) => previewText(s, n);

export class Automations {
  /**
   * @param {{ hermesHome: string, dataDir: string, store: object|null, inbox: import('./inbox.mjs').Inbox,
   *   backfillHours?: number, ignore?: string[], onItem?: (item: object, info: { repeat: boolean }) => void, log?: (s: string) => void,
   *   now?: () => number }} o
   */
  constructor({ hermesHome, dataDir, store, inbox, backfillHours = 0, ignore = [], onItem = () => {}, log = () => {}, now = () => Date.now() / 1000 }) {
    this.cronDir = path.join(hermesHome, 'cron');
    this.outputDir = path.join(this.cronDir, 'output');
    this.store = store;
    this.inbox = inbox;
    this.ignore = new Set(ignore.map((x) => x.toLowerCase()));
    this.onItem = onItem;
    this.log = log;
    this.now = now;
    this.file = path.join(dataDir, 'automations.json');
    let state = null;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first start */ }
    const start = now() - Math.max(0, Number(backfillHours) || 0) * 3600;
    // started: the first start's starting point; runs before it are never picked up, not even by the lookback.
    this.state = { cron: state?.cron ?? start, webhook: state?.webhook ?? start, started: state?.started ?? start, recent: state?.recent ?? {} };
    if (!state) this.save();
    this.jobs = { mtime: 0, byId: new Map() };
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  ignored(name) { return !!name && this.ignore.has(String(name).toLowerCase()); }

  /** Current job names (a job can be renamed; the archive keeps the name of its run). */
  jobName(id) {
    try {
      const file = path.join(this.cronDir, 'jobs.json');
      const st = fs.statSync(file);
      if (st.mtimeMs !== this.jobs.mtime) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const list = Array.isArray(raw) ? raw : raw.jobs || [];
        this.jobs = { mtime: st.mtimeMs, byId: new Map(list.map((j) => [j.id, j.name || j.id])) };
      }
    } catch { /* no jobs.json */ }
    return this.jobs.byId.get(id) || null;
  }

  /** One pass over both sources. Returns the number of new entries. */
  scan() {
    let n = 0;
    try { n += this.scanCron(); } catch (err) { this.warn('cron', err); }
    try { n += this.scanWebhooks(); } catch (err) { this.warn('webhook', err); }
    return n;
  }

  /** Logs a failing scan once per distinct error, not every interval. */
  warn(what, err) {
    const line = `automations: ${what} scan failed (${err.message})`;
    if (this.lastWarn?.[what] === line) return;
    this.lastWarn = { ...this.lastWarn, [what]: line };
    this.log(line);
  }

  scanCron() {
    let dirs;
    try { dirs = fs.readdirSync(this.outputDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return 0; }
    // An archive's mtime is when Hermes wrote it, before the rename that makes it visible, so a slower write
    // can appear after a newer one was seen. Look back LOOKBACK seconds behind the cursor; runs seen in that
    // window are remembered (`recent`), because a folded repeat has no inbox entry of its own to recognise it by.
    const since = this.state.cron - LOOKBACK;
    const recent = this.state.recent;
    const files = [];
    for (const d of dirs) {
      const dir = path.join(this.outputDir, d.name);
      // A new archive changes its directory's mtime (Hermes writes a temp file and renames it).
      try { if (fs.statSync(dir).mtimeMs / 1000 < since) continue; } catch { continue; }
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || !name.endsWith('.md')) continue;
        const file = path.join(dir, name);
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        const at = st.mtimeMs / 1000;
        const id = `cron:${d.name}:${name.replace(/\.md$/, '')}`;
        if (at > since && at > this.state.started && !(id in recent)) files.push({ id, jobId: d.name, file, at });
      }
    }
    files.sort((a, b) => a.at - b.at);
    let n = 0;
    let cursor = this.state.cron;
    for (const f of files) {
      cursor = Math.max(cursor, f.at);
      recent[f.id] = f.at;
      if (this.inbox.has(f.id)) continue;
      let doc;
      try { doc = fs.readFileSync(f.file, 'utf8'); } catch { continue; }
      const run = classifyRun(doc);
      if (run.status === 'silent') continue;
      const group = this.jobName(f.jobId) || run.jobName || f.jobId;
      if (this.ignored(group) || this.ignored(f.jobId)) continue;
      let sessionId = null;
      if (run.mode === 'agent' && this.store?.cronSessionFor) {
        try { sessionId = this.store.cronSessionFor({ names: [...new Set([run.jobName, group])].filter(Boolean), jobId: f.jobId, at: f.at, answer: run.status === 'ok' ? run.body : null }); } catch { /* older state.db */ }
      }
      if (this.add({ id: f.id, source: 'cron', group, jobId: f.jobId, status: run.status, title: run.title || group, body: run.body, sessionId, at: f.at })) n++;
    }
    for (const [id, at] of Object.entries(recent)) if (at < cursor - LOOKBACK) delete recent[id];
    if (files.length || cursor !== this.state.cron) { this.state.cron = cursor; this.save(); }
    return n;
  }

  scanWebhooks() {
    if (!this.store?.webhookRunsSince) return 0;
    const rows = this.store.webhookRunsSince(this.state.webhook, 200);
    let n = 0;
    let cursor = this.state.webhook;
    for (const r of rows) {
      cursor = Math.max(cursor, r.ended_at);
      const id = `webhook:${r.id}`;
      if (this.inbox.has(id)) continue;
      const route = String(r.route || '').replace(/^webhook\//, '') || 'webhook';
      if (this.ignored(route)) continue;
      const reply = String(r.last || '').trim();
      let status = 'ok';
      if (!reply) {
        // No reply: Hermes delivers nothing. Only an unexpected end is worth an entry.
        if (!r.end_reason || r.end_reason === 'webhook_complete') continue;
        status = 'error';
      } else if (isSilence(reply)) continue;
      const title = status === 'error' ? `Run ended: ${r.end_reason}` : titleOf(reply) || r.title || route;
      if (this.add({ id, source: 'webhook', group: route, status, title, body: reply, sessionId: r.id, at: r.ended_at })) n++;
    }
    if (cursor !== this.state.webhook) { this.state.webhook = cursor; this.save(); }
    return n;
  }

  /**
   * Adds one entry. The same error again (same source and group, same text) is folded into the
   * latest entry of that group (repeat counter, newer time, unread again) instead of a new row.
   */
  add({ id, source, group, jobId, status, title, body, sessionId, at }) {
    const text = oneLine(body) || oneLine(title);
    const entry = { id, kind: 'automation', source, group, status, title: oneLine(title, 160), text, body: clipBody(body || ''), sessionId: sessionId || null, at, ...(jobId ? { jobId } : {}) };
    if (status === 'error') {
      const prev = this.inbox.items.find((x) => x.kind === 'automation' && x.source === source && x.group === group);
      if (prev && prev.status === 'error' && prev.title === entry.title && prev.text === entry.text) {
        const item = this.inbox.update(prev.id, { repeat: (prev.repeat || 1) + 1, at: Math.max(prev.at, at), read: false, sessionId: entry.sessionId || prev.sessionId });
        this.inbox.items.sort((a, b) => b.at - a.at);
        this.onItem(item, { repeat: true });
        return null;
      }
    }
    const item = this.inbox.add(entry);
    if (item) { this.inbox.items.sort((a, b) => b.at - a.at); this.onItem(item, { repeat: false }); }
    return item;
  }
}
