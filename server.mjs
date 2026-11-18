#!/usr/bin/env node
// Hermes Kanban: local web UI for Hermes sessions. Binds to 127.0.0.1 only.
//   reads   ~/.hermes/state.db (read-only) for the board and transcripts,
//   writes  through the gateway WebSocket the Hermes desktop app uses (session.create / prompt.submit),
//   pushes  live updates to the browser via Server-Sent Events.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './src/config.mjs';
import { IrohGateway } from './src/iroh.mjs';
import { t, setLang } from './src/i18n.mjs';
import { Store } from './src/store.mjs';
import { Board } from './src/board.mjs';
import { HermesGateway } from './src/hermes-ws.mjs';
import { Remote } from './src/remote.mjs';
import { Devices } from './src/devices.mjs';
import { Paseo } from './src/paseo.mjs';
import QRCode from 'qrcode';

const cfg = loadConfig(process.argv.slice(2));
setLang(cfg.lang);
const TOKEN = cfg.token;
const PORT = cfg.port;
const HOST = cfg.host;
const HERMES_HOME = cfg.hermesHome;
const SYSTEM_SOURCES = new Set(['cron', 'tool', 'subagent', 'oneshot', 'webhook', 'kanban', 'api_server']);

const WEB_DIST = cfg.uiDir;

const store = new Store(path.join(HERMES_HOME, 'state.db'));
// Paseo is optional: KANBAN_PASEO=off, or simply no daemon running (it then stays disconnected quietly).
const paseo = new Paseo({ url: cfg.paseo.url, opsLoopFile: cfg.paseo.opsLoopFile });
const PASEO_ON = cfg.paseo.mode !== 'off';
const devices = new Devices(cfg.dataDir);
const remote = cfg.remote === 'iroh'
  ? new IrohGateway({ port: PORT, dataDir: cfg.dataDir, iroh: cfg.iroh })
  : new Remote({ mode: cfg.remote, port: PORT, dataDir: cfg.dataDir, authKey: cfg.tailscale.authKey, hostname: cfg.tailscale.hostname });
let lastRemoteLog = '';
remote.on('state', (st) => {
  const line = `remote ${st.mode}: ${st.status}${st.url ? ` ${st.url}` : ''}${st.endpointId ? ` endpoint ${st.endpointId}` : ''}${st.relayUrl ? ` via ${st.relayUrl}` : ''}${st.loginUrl ? ` login: ${st.loginUrl}` : ''}${st.error ? ` (${st.error})` : ''}`;
  if (line !== lastRemoteLog) console.log((lastRemoteLog = line));
  broadcast('remote', remoteView());
});
const remoteView = () => ({ ...remote.state, uiUrl: cfg.uiUrl || null });
// The iroh gateway admits only paired devices (plus everyone while a pairing code is open).
const syncIrohAccess = () => {
  if (cfg.remote !== 'iroh') return;
  remote.setAllowed(devices.irohIds());
  remote.setPairingOpen(devices.pairingOpen());
};
setInterval(syncIrohAccess, 30000);
const board = new Board(cfg.dataDir);
const gateway = new HermesGateway({ hermesHome: HERMES_HOME });

// ---------- live state from gateway events ----------
const live = new Map(); // sessionId -> { running, activity, prompts: Map<prompt_id, prompt>, generation, at }
const getLive = (id) => {
  if (!live.has(id)) live.set(id, { running: undefined, activity: '', prompts: new Map(), generation: null, at: 0 });
  return live.get(id);
};

// Pending approval/clarify prompts as the board shows them (shape of CanonicalPendingPrompt).
function promptView(p) {
  return {
    promptId: p.prompt_id,
    kind: p.kind,
    generation: p.execution_generation,
    command: p.command || null,
    description: p.description || null,
    question: p.question || null,
    choices: Array.isArray(p.choices) ? p.choices : [],
    multiSelect: !!p.multi_select,
    edit: p.edit || null,
    timeoutS: p.timeout_s ?? null,
    at: p.at || Date.now(),
  };
}
function setPrompts(id, prompts) {
  const lv = getLive(id);
  lv.prompts = new Map((prompts || []).filter((p) => p?.prompt_id && (p.kind === 'approval' || p.kind === 'clarify')).map((p) => [p.prompt_id, { ...p, at: Date.now() }]));
}

const plain = (s) => String(s ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`|^#+\s|^\s*[-*]\s/gm, '');
const clip = (s, n) => {
  const t = plain(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function cleanPrompt(text) {
  const t = String(text ?? '');
  const skill = t.match(/^\[IMPORTANT: The user has invoked the "([^"]+)" skill/);
  if (skill) return `⚡ Skill „${skill[1]}“`;
  return t.replace(/\n*\[Image attached at: [^\]\n]+\]/g, ' 🖼').replace(/\n*\[screenshot\]/g, '').replace(/^"|"$/g, '').trim();
}

function columnFor(row, lv, src) {
  if (row.archived) return 'done';
  if (lv?.prompts?.size) return 'waiting';
  const running = lv?.running === true || ((row.admitted || row.leased) && lv?.running !== false);
  if (running) return 'doing';
  if (SYSTEM_SOURCES.has(src) && src !== 'kanban') {
    // Cron/oneshot runs stamp ended_at when they finish; until then the run is in flight.
    if (!row.ended_at && row.message_count > 0 && Date.now() / 1000 - (row.last_activity_at || row.started_at) < 1800) return 'doing';
    if (!row.ended_at && !row.message_count && Date.now() / 1000 - row.started_at < 90) return 'doing';
    return 'done';
  }
  if (!row.last_msg_id) return 'new';
  if (isCronMirror(row)) return 'done';
  // Interactive sessions never go to Done by themselves: only the user moves them there.
  return 'waiting';
}

// Slack sessions that only carry a cron job's delivery (no conversation of their own).
const isCronMirror = (row) => /^\[Cron delivery/.test(row.first_prompt || '');

function sourceLabel(row) {
  if (board.data.created[row.id]) return 'kanban';
  if (row.created_source === 'desktop' || row.source === 'gui' || row.source === 'local') return 'desktop';
  return row.source;
}

// ---------- Paseo agents per session (derived from Hermes' own transcript) ----------
// rel: created (session started the agent) > steers (sent it messages / answered permissions / archived it)
//      > watches (only read it: get_agent, read_timeline, wait_for_agent).
const REL_RANK = { created: 3, steers: 2, watches: 1 };
const sessionAgents = new Map(); // sessionId -> Map<agentRef, { rel, at }>
const agentSessions = new Map(); // agentRef -> Set<sessionId>
let paseoScanned = 0;
const UUID = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/;
function linkAgent(sessionId, ref, rel, at) {
  if (!ref) return;
  const m = sessionAgents.get(sessionId) || new Map();
  const prev = m.get(ref);
  if (!prev || REL_RANK[rel] > REL_RANK[prev.rel]) m.set(ref, { rel, at: prev?.at ?? at });
  sessionAgents.set(sessionId, m);
  if (!agentSessions.has(ref)) agentSessions.set(ref, new Set());
  agentSessions.get(ref).add(sessionId);
}
function scanPaseoRefs() {
  const touched = new Set();
  for (const r of store.paseoRefs(paseoScanned)) {
    paseoScanned = Math.max(paseoScanned, r.id);
    if (r.role === 'tool') {
      const m = String(r.content || '').match(/"id"\s*:\s*"([0-9a-f-]{36})"/) || String(r.content || '').match(UUID);
      if (m) { linkAgent(r.session_id, m[1], 'created', r.timestamp); touched.add(r.session_id); }
      continue;
    }
    let calls = [];
    try { calls = JSON.parse(r.tool_calls || '[]'); } catch { /* ignore */ }
    for (const c of calls) {
      const name = c?.function?.name || c?.name || '';
      if (!name.startsWith('mcp__paseo__paseo_')) continue;
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* ignore */ }
      const ref = String(args.agent_id || '').trim();
      if (!ref) continue;
      const rel = /send_message|respond_permission|archive_agent/.test(name) ? 'steers' : 'watches';
      linkAgent(r.session_id, ref, rel, r.timestamp);
      touched.add(r.session_id);
    }
  }
  return touched;
}
// Agent refs may be short prefixes (like `paseo ls` prints); resolve against what the daemon knows.
function paseoFor(sessionId) {
  const refs = sessionAgents.get(sessionId);
  if (!refs) return [];
  const out = new Map();
  for (const [ref, { rel, at }] of refs) {
    const id = paseo.resolve(ref) || (UUID.test(ref) ? ref : null);
    if (!id) continue;
    if (!paseo.agents.has(id)) paseo.ensure(id); // archived ones load lazily and push a card update
    const prev = out.get(id);
    if (!prev || REL_RANK[rel] > REL_RANK[prev.rel]) out.set(id, { ...paseo.view(id), rel, linkedAt: at });
  }
  const order = { 'needs-attention': 0, running: 1, error: 2, finished: 3, idle: 4, closed: 5, unknown: 6, archived: 7 };
  return [...out.values()].sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5) || REL_RANK[b.rel] - REL_RANK[a.rel]);
}
paseo.on('agent', (id) => {
  const sessions = new Set([...(agentSessions.get(id) || [])]);
  for (const [ref, set] of agentSessions) if (ref !== id && id.startsWith(ref)) set.forEach((s) => sessions.add(s));
  for (const sid of sessions) pushCard(sid);
});
paseo.on('status', (ok) => { console.log(`paseo ${ok ? 'connected' : 'disconnected'}`); for (const sid of sessionAgents.keys()) pushCard(sid); });
paseo.on('log', (m) => console.log(m));

// Cron ticks that never ran an agent leave an empty session row behind; they are noise.
const isEmptyShell = (row) => SYSTEM_SOURCES.has(row.source) && !row.message_count && !row.ended_at
  && Date.now() / 1000 - row.started_at >= 90 && !board.data.created[row.id];

function toCard(row) {
  const lv = live.get(row.id);
  const src = sourceLabel(row);
  let column = columnFor(row, lv, src);
  const autoColumn = column;
  const ov = board.data.overrides[row.id];
  // Done sticks until the user writes again (new user message); other manual columns until any new message.
  const overridden = ov && (ov.column === 'done'
    ? (row.last_user_id ?? 0) <= (ov.userMsgId ?? ov.msgId) && !(lv?.running && lv.at > ov.at)
    : (row.last_msg_id ?? 0) <= ov.msgId);
  if (overridden) column = ov.column;
  const pending = lv?.prompts?.size ? [...lv.prompts.values()].map(promptView) : [];
  // N6: Hermes is done, but agents it started or steers are still at work -> Doing, not Waiting.
  const agents = paseoFor(row.id);
  const owned = agents.filter((a) => a.rel !== 'watches' && !a.archived);
  const blocked = owned.filter((a) => a.state === 'needs-attention');
  const busy = owned.filter((a) => a.state === 'running');
  let paseoNote = '';
  if (!pending.length && (autoColumn === 'waiting' || autoColumn === 'doing') && !SYSTEM_SOURCES.has(row.source)) {
    if (blocked.length) {
      paseoNote = t('paseoBlocked', { title: blocked[0].title });
      if (autoColumn === 'waiting' && !overridden) column = 'waiting';
    } else if (busy.length && autoColumn === 'waiting') {
      paseoNote = t('paseoRunningList', { n: busy.length, titles: busy.map((a) => a.title).join(', ') });
      if (!overridden) column = 'doing';
    } else if (busy.length) {
      paseoNote = t('paseoRunning', { n: busy.length });
    }
  }
  let activity = '';
  if (pending.length) {
    const p = pending[0];
    activity = p.kind === 'approval' ? t('approvalNeeded', { what: p.description || p.command }) : t('question', { what: p.question });
  } else if (paseoNote && autoColumn === 'waiting') activity = paseoNote;
  else if (autoColumn === 'doing') activity = lv?.activity || row.last_activity_description || (row.message_count ? t('working') : t('starting'));
  else if (row.last_assistant) activity = `💬 ${clip(row.last_assistant, 180)}`;
  else if (row.last_activity_description) activity = row.last_activity_description;
  const prompt = cleanPrompt(row.first_prompt);
  return {
    id: row.id,
    title: row.title || clip(prompt, 70) || t('newSession'),
    source: src,
    system: (SYSTEM_SOURCES.has(row.source) || isCronMirror(row)) && !board.data.created[row.id],
    column,
    autoColumn,
    override: !!overridden,
    running: autoColumn === 'doing' || (!!paseoNote && column === 'doing'),
    paseoNote,
    paseo: agents.map(({ id, title, state, status, rel, account, kind, archived, pendingPermissions }) => ({ id, title, state, status, rel, account, kind, archived, pendingCount: pendingPermissions?.length || 0 })),
    activity: clip(activity, 220),
    initialPrompt: clip(prompt, 400),
    createdAt: row.started_at,
    updatedAt: Math.max(row.last_activity_at || row.started_at || 0, (lv?.at || 0) / 1000),
    messageCount: row.message_count,
    test: !!board.data.test[row.id] || /^TEST\b/.test(row.title || ''),
    pending,
  };
}

function draftCard(d) {
  return {
    id: d.id,
    title: d.title || clip(d.text, 70) || t('newTask'),
    source: 'kanban',
    system: false,
    column: 'new',
    autoColumn: 'new',
    override: false,
    running: false,
    draft: true,
    activity: t('draftNotStarted'),
    initialPrompt: clip(d.text || (d.audio ? t('voiceMessage') : ''), 400),
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
    messageCount: 0,
    test: !!d.test,
    pending: [],
    paseo: [],
    paseoNote: '',
  };
}

function cardById(id) {
  if (id.startsWith('draft:')) return board.data.drafts[id] ? draftCard(board.data.drafts[id]) : null;
  const row = store.getSession(id);
  return row && !isEmptyShell(row) ? toCard(row) : null;
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}
const pushTimers = new Map();
// Cards whose column only changes with time (cron shells that never ran, idle -> done) get re-checked.
const timeWatch = new Map(); // id -> last pushed column
function pushCard(id, now = false) {
  const send = () => {
    pushTimers.delete(id);
    const card = cardById(id);
    if (card) {
      broadcast('session', card);
      if (card.autoColumn === 'doing' && card.system) timeWatch.set(id, card.column);
    } else if (timeWatch.has(id)) {
      timeWatch.delete(id);
      broadcast('removed', { id });
    }
  };
  if (now) { clearTimeout(pushTimers.get(id)); send(); return; }
  if (!pushTimers.has(id)) pushTimers.set(id, setTimeout(send, 350));
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

gateway.on('status', (ok) => { console.log(`gateway ${ok ? 'connected' : 'disconnected'}`); broadcast('gateway', { connected: ok }); });
gateway.on('log', (m) => console.log(m));
gateway.on('event', (ev) => {
  const id = ev.session_id;
  if (ev.type === 'sessions.changed') { poll(); return; }
  if (!id) return;
  const lv = getLive(id);
  const p = ev.payload || {};
  lv.at = Date.now();
  if (ev.execution_generation != null) lv.generation = ev.execution_generation;
  switch (ev.type) {
    case 'message.start':
      lv.running = true; lv.activity = t('thinking'); break;
    case 'reasoning.delta':
      lv.running = true; if (!/^🔧/.test(lv.activity)) lv.activity = t('thinking'); break;
    case 'message.delta':
      lv.running = true; lv.activity = t('writing');
      if (p.text) broadcast('delta', { id, text: p.text });
      break;
    case 'tool.start':
      lv.running = true;
      lv.activity = `🔧 ${p.name}${p.preview ? `: ${clip(p.preview, 140)}` : ''}`;
      broadcast('message', { id, message: { role: 'tool', toolName: p.name, summary: clip(p.preview, 140), text: '', ts: Date.now() / 1000, live: true } });
      break;
    case 'tool.complete':
      lv.activity = `✓ ${p.name}${p.summary ? `: ${clip(p.summary, 140)}` : ''}`; break;
    case 'message.complete':
      lv.running = false; lv.activity = p.error ? `⚠️ ${clip(p.error, 160)}` : '';
      lv.prompts.clear(); // a finished turn has no open prompts (late *.settled may never come)
      setTimeout(() => { broadcast('reload', { id, final: true }); pushCard(id, true); }, 300);
      return;
    case 'approval.request':
    case 'clarify.request':
      if (p.prompt_id) lv.prompts.set(p.prompt_id, { kind: ev.type.split('.')[0], ...p, at: Date.now() });
      broadcast('reload', { id, final: false });
      break;
    case 'approval.settled':
    case 'clarify.settled':
      lv.prompts.delete(p.prompt_id); break;
    case 'approval.cancelled':
      for (const [k, v] of lv.prompts) if (v.kind === 'approval') lv.prompts.delete(k);
      break;
    case 'session.title':
    case 'session.info':
    case 'status.update':
      break;
    default:
      return;
  }
  pushCard(id);
});

gateway.on('snapshot', (id, snap) => {
  const lv = getLive(id);
  if (snap?.execution_generation != null) lv.generation = snap.execution_generation;
  if (typeof snap?.running === 'boolean') lv.running = snap.running;
  setPrompts(id, snap?.prompts);
  pushCard(id);
});

// Follow running interactive sessions so their approval/clarify prompts reach the board,
// even when they were started in Slack or the desktop app. Bounded, oldest dropped first.
const followed = [];
function follow(id) {
  if (!gateway.connected || gateway.subscribed.has(id)) return;
  gateway.resume(id).catch((err) => console.warn(`resume ${id}: ${err.message}`));
  followed.push(id);
  while (followed.length > 60) {
    const old = followed.shift();
    if (old !== openFollow) { gateway.subscribed.delete(old); gateway.call('session.detach', { session_id: old }).catch(() => {}); }
  }
}
let openFollow = null;

// ---------- DB poll (sessions from Slack, cron, desktop appear live) ----------
let lastMark = store.watermark();
let lastIds = store.maxIds();
function poll() {
  try {
    const mark = store.watermark();
    if (mark === lastMark) return;
    const changed = store.changedSince(lastIds.msg, lastIds.act);
    const prevMsg = lastIds.msg;
    lastMark = mark;
    lastIds = store.maxIds();
    if (PASEO_ON) for (const sid of scanPaseoRefs()) changed.push(sid);
    for (const id of new Set(changed)) {
      const row = store.getSession(id);
      if (row && (row.admitted || row.leased) && !SYSTEM_SOURCES.has(row.source)) follow(id);
      pushCard(id);
      broadcast('reload', { id, final: false, sinceMsg: prevMsg });
    }
  } catch (err) { console.error('poll', err.message); }
}
setInterval(poll, 1500);
setInterval(() => {
  for (const [id, col] of timeWatch) {
    const card = cardById(id);
    if (!card) { timeWatch.delete(id); broadcast('removed', { id }); continue; }
    if (card.column !== col) { broadcast('session', card); }
    if (card.autoColumn !== 'doing') timeWatch.delete(id); else timeWatch.set(id, card.column);
  }
}, 15000);

// ---------- thread ----------
function threadMessages(id) {
  const rows = store.messages(id);
  const media = [...(board.data.media[id] || [])];
  const out = [];
  for (const r of rows) {
    if (r.role === 'tool') {
      out.push({ id: r.id, role: 'tool', toolName: r.tool_name || 'Tool', text: clip(r.content, 4000), ts: r.timestamp });
      continue;
    }
    if (r.role === 'assistant' && !String(r.content || '').trim()) continue;
    const msg = { id: r.id, role: r.role, text: r.role === 'user' ? cleanUserText(r.content) : r.content, ts: r.timestamp, attachments: [] };
    if (r.role === 'user') {
      // Images Hermes stored for this turn (desktop, Slack, this board) are referenced by path in the text.
      const marked = [];
      msg.text = msg.text.replace(/\n*\[Image attached at: ([^\]\n]+)\]/g, (_, file) => {
        marked.push({ kind: 'image', url: `/api/hermes-file?path=${encodeURIComponent(file)}` });
        return '';
      }).replace(/\n*\[screenshot\]\s*$/, '').trim();
      msg.attachments.push(...marked);
      for (let i = media.length - 1; i >= 0; i--) {
        if (r.id > media[i].afterMsgId) {
          if (!(marked.length && media[i].kind === 'image')) msg.attachments.push(media[i]);
          media.splice(i, 1);
        }
      }
    }
    out.push(msg);
  }
  return out;
}
function cleanUserText(text) {
  const t = String(text ?? '');
  const skill = t.match(/^\[IMPORTANT: The user has invoked the "([^"]+)" skill/);
  if (!skill) return t;
  const userPart = t.split(/\n---\n/).pop();
  return `⚡ Skill „${skill[1]}“${userPart && userPart.length < 4000 ? `\n\n${userPart}` : ''}`;
}

// ---------- sending ----------
async function sendPrompt(id, { text = '', images = [], audio = null }) {
  const row = store.getSession(id);
  const afterMsgId = row?.last_msg_id || 0;
  const attachments = [];
  const media = (board.data.media[id] ||= []);
  for (const img of images) {
    media.push({ afterMsgId, kind: 'image', url: board.saveMedia(id, img) });
    attachments.push(await gateway.uploadImage(img));
  }
  let body = text;
  if (audio) {
    const url = board.saveMedia(id, { ...audio, name: 'voice' });
    media.push({ afterMsgId, kind: 'audio', url });
    let transcript = '';
    try {
      const res = await gateway.transcribe(audio);
      transcript = res.ok !== false ? (res.transcript || '').trim() : '';
      if (!transcript) console.warn('transcribe: empty', JSON.stringify(res).slice(0, 200));
    } catch (err) { console.warn('transcribe failed:', err.message); }
    if (transcript) body = body ? `${body}\n\n🎙 ${transcript}` : transcript;
    else {
      const file = board.mediaPath(...url.split('/').slice(-2).map(decodeURIComponent));
      body = `${body ? `${body}\n\n` : ''}${t('voiceNotTranscribed', { file })}`;
    }
  }
  board.save();
  const lv = getLive(id);
  lv.running = true;
  lv.activity = t('started');
  lv.at = Date.now();
  // A new turn always releases a manual column (incl. Done).
  delete board.data.overrides[id];
  const admission = await gateway.submit(id, { text: body || t('seeAttachment'), attachments, voice: !!audio });
  if (admission?.execution_generation != null) lv.generation = admission.execution_generation;
  pushCard(id, true);
  return { body, admission };
}

async function startSession({ title, text, images = [], audio = null, test = false }) {
  const stamp = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const base = clip(String(title || text || t('voiceTitle')).replace(/^TEST\b\s*[·:]?\s*/i, ''), 40);
  const finalTitle = test ? `TEST · ${base} · ${stamp}` : title || undefined;
  const { id } = await gateway.createSession({ title: finalTitle });
  board.data.created[id] = Date.now();
  if (test) board.data.test[id] = true;
  board.save();
  pushCard(id, true); // shows up in "New Task" first
  // Submit right after so the card visibly travels New Task -> Doing.
  setTimeout(() => sendPrompt(id, { text, images, audio }).catch((err) => {
    getLive(id).activity = `⚠️ ${err.message}`;
    getLive(id).running = false;
    pushCard(id, true);
  }), 600);
  return id;
}

async function startDraft(draftId) {
  const d = board.data.drafts[draftId];
  if (!d) throw new Error('draft not found');
  const loadMedia = (m) => m && { type: m.type, name: m.name, data: fs.readFileSync(board.mediaPath(...m.url.split('/').slice(-2).map(decodeURIComponent))).toString('base64') };
  const id = await startSession({ title: d.title, text: d.text, test: d.test, images: (d.images || []).map(loadMedia), audio: loadMedia(d.audio) });
  delete board.data.drafts[draftId];
  board.save();
  broadcast('removed', { id: draftId });
  return id;
}

// ---------- http ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
const tokenOk = (given) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// A request is local only when it reached us directly on loopback with a loopback Host header.
// Tunnels (cloudflared, tailscaled) also connect from loopback, but carry their public Host / forwarding headers.
function isLocal(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const fwd = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['tailscale-user-login'] || req.headers['x-forwarded-host'] || req.headers['x-iroh-remote-id'];
  return !fwd && ['127.0.0.1', 'localhost', '[::1]'].includes(host);
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
// Bearer/query token (scripts, legacy) or the HttpOnly device cookie issued by /api/login or pairing.
// iroh: the gateway sets X-Iroh-Remote-Id from the QUIC handshake (clients cannot forge it through
// the gateway). It is trusted only on loopback connections, i.e. coming from our own gateway child.
const irohId = (req) => (cfg.remote === 'iroh' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  ? String(req.headers['x-iroh-remote-id'] || '') : '');
function authorized(req, url) {
  const rid = irohId(req);
  if (rid) {
    // Over iroh only the paired device identity counts, never a cookie or token.
    const d = devices.verifyIroh(rid);
    return d ? { via: 'iroh', device: d } : null;
  }
  const h = req.headers.authorization || '';
  if (tokenOk(h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token'))) return { via: 'token' };
  const dev = devices.verify(cookies(req).hk_device);
  if (dev) return { via: 'device', device: dev };
  return null;
}
function deviceCookie(req, value, maxAgeS) {
  const secure = !isLocal(req) ? '; Secure' : '';
  return `hk_device=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure}`;
}
// Brute-force brake for login/pairing: 10 failures per client per 10 minutes.
const failures = new Map();
function clientKey(req) { return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress); }
function limited(req) {
  const f = failures.get(clientKey(req));
  return f && f.count >= 10 && Date.now() - f.since < 600000;
}
function fail(req) {
  const k = clientKey(req);
  const f = failures.get(k);
  if (!f || Date.now() - f.since > 600000) failures.set(k, { count: 1, since: Date.now() });
  else f.count++;
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 60 * 1024 * 1024) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const SECURITY_HEADERS = { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const MEDIA = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.webm': 'audio/webm', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  let m0;
  try {
    if (!p.startsWith('/api/')) {
      if (!cfg.ui) return send(res, 404, { error: 'headless: UI disabled (KANBAN_UI=off)' });
      // React build (web/dist); unknown paths fall back to index.html (client-side routes like /pair).
      let file = path.join(WEB_DIST, decodeURIComponent(p));
      if (!file.startsWith(WEB_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIST, 'index.html');
      if (!fs.existsSync(file)) return send(res, 503, { error: 'frontend not built – run npm run build' });
      const immutable = file.includes(`${path.sep}assets${path.sep}`);
      res.writeHead(200, { 'Content-Type': STATIC[path.extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ...SECURITY_HEADERS });
      return fs.createReadStream(file).pipe(res);
    }

    // ---- unauthenticated: login with the board token, or redeem a pairing code ----
    if (p === '/api/login' && req.method === 'POST') {
      if (limited(req)) return send(res, 429, { error: 'Zu viele Versuche, bitte 10 Minuten warten.' });
      const { token, name } = await readJson(req);
      if (!tokenOk(token)) { fail(req); return send(res, 401, { error: 'Token falsch' }); }
      const dev = devices.issue({ name: name || 'Browser', via: 'token', remote: !isLocal(req) });
      return send(res, 200, { ok: true }, { 'Set-Cookie': deviceCookie(req, dev.cookie, dev.maxAgeS) });
    }
    if (p === '/api/pair/redeem' && req.method === 'POST') {
      if (limited(req)) return send(res, 429, { error: 'Zu viele Versuche, bitte 10 Minuten warten.' });
      const { code, name } = await readJson(req);
      const rid = irohId(req);
      const dev = devices.redeem(code, { name: name || 'Device', remote: !isLocal(req), irohId: rid || null });
      if (!dev) { fail(req); return send(res, 401, { error: 'Pairing code invalid or expired' }); }
      syncIrohAccess();
      broadcast('devices', devices.list());
      return send(res, 200, { ok: true }, { 'Set-Cookie': deviceCookie(req, dev.cookie, dev.maxAgeS) });
    }

    const auth = authorized(req, url);
    if (!auth) return send(res, 401, { error: 'unauthorized' });

    if (p === '/api/logout' && req.method === 'POST') {
      if (auth.device) devices.revoke(auth.device.id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': deviceCookie(req, '', 0) });
    }
    if (p === '/api/remote' && req.method === 'GET') {
      return send(res, 200, { remote: remoteView(), devices: devices.list(), local: isLocal(req), current: auth.device?.id || null });
    }
    // Pairing codes are minted only from the Mac itself, so a leaked remote session cannot add devices.
    if (p === '/api/pair' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: 'Pairing is only possible on the host machine' });
      let link, code, expiresAt;
      if (cfg.remote === 'iroh') {
        const st = remote.state;
        if (!st.endpointId) return send(res, 409, { error: 'iroh gateway is not online yet' });
        // The UI is a static PWA (any host, e.g. GitHub Pages); it learns where to connect from the fragment,
        // which never reaches a server.
        const ui = cfg.uiUrl || `http://127.0.0.1:${PORT}`;
        ({ code, expiresAt } = devices.pairingCode());
        const frag = new URLSearchParams({ iroh: st.endpointId, ...(st.relayUrl ? { relay: st.relayUrl } : {}), pair: code });
        link = `${ui}/#${frag}`;
        syncIrohAccess();
        setTimeout(syncIrohAccess, 10 * 60 * 1000 + 1000);
      } else {
        const base = remote.state.url;
        if (!base) return send(res, 409, { error: 'Remote access is not online' });
        ({ code, expiresAt } = devices.pairingCode());
        link = `${base}/pair#${code}`;
      }
      const svg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return send(res, 200, { link, svg, expiresAt });
    }
    if ((m0 = p.match(/^\/api\/devices\/([^/]+)$/)) && req.method === 'DELETE') {
      devices.revoke(decodeURIComponent(m0[1]));
      syncIrohAccess();
      broadcast('devices', devices.list());
      return send(res, 200, { ok: true, devices: devices.list() });
    }

    if (p === '/api/events') {
      // X-Accel-Buffering: tunnels must not buffer the stream.
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: gateway\ndata: ${JSON.stringify({ connected: gateway.connected })}\n\n`);
      res.write(`event: remote\ndata: ${JSON.stringify(remoteView())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/health') return send(res, 200, { ok: true, gateway: gateway.connected, origin: gateway.origin });

    let m;
    if ((m = p.match(/^\/api\/media\/([^/]+)\/([^/]+)$/))) {
      const file = board.mediaPath(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MEDIA[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p === '/api/hermes-file') {
      // Read-only access to images Hermes cached for chats, nothing else under ~/.hermes.
      const file = path.resolve(url.searchParams.get('path') || '');
      const allowed = path.join(HERMES_HOME, 'cache') + path.sep;
      if (!file.startsWith(allowed) || !/^image\//.test(MEDIA[path.extname(file).toLowerCase()] || '') || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MEDIA[path.extname(file).toLowerCase()], 'Cache-Control': 'private, max-age=3600' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p === '/api/sessions' && req.method === 'GET') {
      const days = Math.min(Number(url.searchParams.get('days') || 3), 90);
      const system = url.searchParams.get('system') === '1';
      const since = Date.now() / 1000 - days * 86400;
      const pinned = [...Object.keys(board.data.created), ...Object.keys(board.data.overrides)];
      const rows = store.listSessions({ sinceTs: since, ids: pinned });
      const cards = rows.filter((r) => !isEmptyShell(r)).map(toCard).filter((c) => system || !c.system);
      const drafts = Object.values(board.data.drafts).map(draftCard);
      return send(res, 200, { sessions: [...drafts, ...cards], gateway: gateway.connected });
    }

    if (p === '/api/sessions' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.draft) {
        const id = `draft:${crypto.randomUUID()}`;
        const d = { id, title: body.title || '', text: body.text || '', test: !!body.test, createdAt: Date.now() / 1000, images: [], audio: null };
        for (const img of body.images || []) d.images.push({ type: img.type, name: img.name, url: board.saveMedia(id, img) });
        if (body.audio) d.audio = { type: body.audio.type, name: 'voice', url: board.saveMedia(id, { ...body.audio, name: 'voice' }) };
        board.data.drafts[id] = d;
        board.save();
        const card = draftCard(d);
        broadcast('session', card);
        return send(res, 200, { session: card });
      }
      const id = await startSession(body);
      return send(res, 200, { session: cardById(id) });
    }

    if ((m = p.match(/^\/api\/sessions\/([^/]+)$/)) && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      if (id.startsWith('draft:')) {
        const d = board.data.drafts[id];
        if (!d) return send(res, 404, { error: 'not found' });
        const attachments = [...d.images.map((i) => ({ kind: 'image', url: i.url })), ...(d.audio ? [{ kind: 'audio', url: d.audio.url }] : [])];
        return send(res, 200, { session: draftCard(d), messages: [{ role: 'user', text: d.text, ts: d.createdAt, attachments }] });
      }
      const card = cardById(id);
      if (!card) return send(res, 404, { error: 'not found' });
      // Follow the session live on our gateway socket (history comes from state.db).
      openFollow = id;
      follow(id);
      return send(res, 200, { session: card, messages: threadMessages(id) });
    }

    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/messages$/)) && req.method === 'POST') {
      const id = decodeURIComponent(m[1]);
      const body = await readJson(req);
      if (id.startsWith('draft:')) {
        const d = board.data.drafts[id];
        if (body.text) d.text = [d.text, body.text].filter(Boolean).join('\n\n');
        const newId = await startDraft(id);
        return send(res, 200, { session: cardById(newId) });
      }
      const { body: sent } = await sendPrompt(id, body);
      const attachments = (board.data.media[id] || []).filter((x) => x.afterMsgId === (store.getSession(id)?.last_msg_id ?? -1));
      return send(res, 200, { session: cardById(id), message: { role: 'user', text: sent, ts: Date.now() / 1000, attachments } });
    }

    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/column$/)) && req.method === 'POST') {
      const id = decodeURIComponent(m[1]);
      const { column } = await readJson(req);
      if (!['auto', 'new', 'doing', 'waiting', 'done'].includes(column)) return send(res, 400, { error: 'bad column' });
      if (id.startsWith('draft:')) {
        if (column === 'doing') {
          const newId = await startDraft(id);
          return send(res, 200, { session: cardById(newId), replaced: id });
        }
        if (column === 'done') {
          delete board.data.drafts[id];
          board.save();
          broadcast('removed', { id });
          return send(res, 200, { session: null, removed: id });
        }
        return send(res, 200, { session: cardById(id) });
      }
      const row = store.getSession(id);
      if (!row) return send(res, 404, { error: 'not found' });
      if (column === 'auto') delete board.data.overrides[id];
      else board.data.overrides[id] = { column, msgId: row.last_msg_id ?? 0, userMsgId: row.last_user_id ?? 0, at: Date.now() };
      board.save();
      const card = toCard(row);
      broadcast('session', card);
      return send(res, 200, { session: card });
    }

    // ---- Paseo (read-only) ----
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/paseo$/)) && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      const list = paseoFor(id);
      await Promise.all(list.filter((a) => !a.known).map((a) => paseo.ensure(a.id)));
      return send(res, 200, { connected: paseo.connected, agents: paseoFor(id) });
    }
    if ((m = p.match(/^\/api\/paseo\/agents\/([0-9a-f-]{36})\/timeline$/)) && req.method === 'GET') {
      const id = m[1];
      await paseo.ensure(id);
      const limit = Math.min(Number(url.searchParams.get('limit') || 150), 400);
      return send(res, 200, await paseo.timeline(id, limit));
    }

    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/respond$/)) && req.method === 'POST') {
      const id = decodeURIComponent(m[1]);
      const { promptId, choice, answer, answers } = await readJson(req);
      const lv = getLive(id);
      const pr = lv.prompts.get(promptId);
      if (!pr) return send(res, 409, { error: t('promptGone') });
      const generation = pr.execution_generation ?? lv.generation;
      let result;
      if (pr.kind === 'approval') {
        if (!(pr.choices || []).includes(choice)) return send(res, 400, { error: t('invalidChoice', { choice }) });
        result = await gateway.respondApproval(id, { generation, promptId, choice });
      } else {
        // Multi-select answers go over the wire as a JSON array string, like the desktop app sends them.
        const text = Array.isArray(answers) ? JSON.stringify(answers) : String(answer ?? '');
        result = await gateway.respondClarify(id, { generation, promptId, answer: text });
      }
      lv.prompts.delete(promptId);
      lv.running = true;
      lv.activity = pr.kind === 'approval' ? (choice === 'deny' ? t('denied') : t('approved')) : t('answered');
      lv.at = Date.now();
      pushCard(id, true);
      return send(res, 200, { ok: true, result, session: cardById(id) });
    }

    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/interrupt$/)) && req.method === 'POST') {
      const id = decodeURIComponent(m[1]);
      const lv = getLive(id);
      await gateway.interrupt(id, lv.generation);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(req.method, p, err);
    return send(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Kanban API on http://${HOST}:${PORT}/api${cfg.ui ? ` · UI on http://${HOST}:${PORT}/` : ' (headless)'} · token: KANBAN_TOKEN in ${cfg.envFile}`);
  gateway.connect();
  syncIrohAccess();
  remote.start();
  if (PASEO_ON) {
    scanPaseoRefs();
    paseo.connect();
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { remote.stop(); process.exit(0); });
