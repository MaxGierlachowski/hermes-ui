// Messages sent from the board that Hermes has not written to its transcript yet.
// A prompt sent while a turn runs does not reach state.db.messages until its own turn starts:
//   - gateway-owned sessions (all chats started from the board, Slack, …): Hermes forwards it to the
//     owner's FIFO, session_admissions (status queued → started → terminal), and it runs as the next turn;
//   - sessions run inside the desktop backend: display.busy_input_mode (redirect / steer into the running
//     turn, or a _queued_prompt row), written at the next model iteration; a Stop drops corrections.
// So the board keeps its own record (board.json, every device sees it) until the user row appears, follows
// the admission when there is one, and marks the message "lost" when nothing took it over.

import { randomUUID } from 'node:crypto';
import { parseUserMessage } from './user-markers.mjs';

// After a turn ended, Hermes starts the next queued turn and writes leftover corrections within seconds.
const LOST_AFTER_MS = 20000;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export class Outbox {
  constructor(board) {
    this.board = board;
    board.data.outbox ||= [];
  }

  get list() { return this.board.data.outbox; }

  forSession(sessionId) { return this.list.filter((e) => e.sessionId === sessionId); }

  get(id) { return this.list.find((e) => e.id === id) || null; }

  add(sessionId, { text, afterMsgId, afterSeq = 0, attachments = [] }) {
    const entry = { id: randomUUID(), sessionId, text, afterMsgId, afterSeq, attachments, ts: Date.now() / 1000, status: 'sending' };
    this.list.push(entry);
    this.board.save();
    return entry;
  }

  update(id, patch) {
    const e = this.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    this.board.save();
    return e;
  }

  remove(id) {
    const i = this.list.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const [e] = this.list.splice(i, 1);
    this.board.save();
    return e;
  }

  /**
   * Match the open entries of one session against what Hermes stored. Returns true when anything changed.
   * @param {{ id: number, content: string, display_kind?: string, display_metadata?: string, active?: number }[]} rows  user rows
   * @param {{ seq: number, admission_id: string, status: string, outcome?: string, text?: string }[]} admissions
   * @param {boolean} running  a turn is in flight for this session
   */
  reconcile(sessionId, rows, admissions, running, now = Date.now()) {
    let changed = false;
    const set = (e, patch) => {
      for (const [k, v] of Object.entries(patch)) if (e[k] !== v) { e[k] = v; changed = true; }
    };
    const usedRows = new Set();
    const usedAdm = new Set();
    for (const e of [...this.forSession(sessionId)]) {
      if (e.status === 'failed') continue;
      const want = norm(parseUserMessage(e.text).text);

      // 1) In the transcript: taken over. Exact text first (two identical messages claim two rows), else a row
      //    that contains it (Hermes merges consecutive queued prompts, voice turns append a transcript).
      const open = rows.filter((r) => r.id > e.afterMsgId && r.active !== 0 && !usedRows.has(r.id))
        .map((r) => ({ r, got: norm(parseUserMessage(r.content, { kind: r.display_kind }).text) }));
      const exact = open.find((x) => (want ? x.got === want : true));
      const hit = exact?.r || (want ? open.find((x) => x.got.includes(want))?.r : null);
      if (hit && !queuedRow(hit)) {
        if (exact) usedRows.add(hit.id);
        this.list.splice(this.list.indexOf(e), 1);
        changed = true;
        continue;
      }
      if (hit) { usedRows.add(hit.id); set(e, { rowId: hit.id, status: 'queued' }); }

      // 2) Hermes' FIFO: by admission id from the submit answer, else by text.
      const adm = (e.admissionId && admissions.find((a) => a.admission_id === e.admissionId))
        || (!e.admissionId && admissions.find((a) => a.seq > (e.afterSeq || 0) && !usedAdm.has(a.seq) && norm(a.text) === norm(e.text)));
      if (adm) {
        usedAdm.add(adm.seq);
        if (!e.admissionId) set(e, { admissionId: adm.admission_id });
        if (adm.status === 'queued' || adm.status === 'started') {
          set(e, { status: adm.status });
          if (e.idleSince) { delete e.idleSince; changed = true; }
          continue;
        }
        if (adm.status === 'terminal' && adm.outcome && adm.outcome !== 'completed') {
          set(e, { status: 'lost', error: adm.outcome });
          continue;
        }
      }

      if (e.status === 'sending' || e.status === 'lost') continue; // submit in flight / already marked
      if (running) { if (e.idleSince) { delete e.idleSince; changed = true; } continue; }
      // 3) Nothing running and the message is nowhere: lost after a grace period.
      if (!e.idleSince) { e.idleSince = now; changed = true; continue; }
      if (now - e.idleSince >= LOST_AFTER_MS) set(e, { status: 'lost' });
    }
    if (changed) this.board.save();
    return changed;
  }
}

export function queuedRow(row) {
  if (!row?.display_metadata) return false;
  try { return JSON.parse(row.display_metadata)?._queued_prompt === true; } catch { return false; }
}
