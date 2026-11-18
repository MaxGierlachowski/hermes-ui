#!/usr/bin/env node
// Hermes UI: local web UI for Hermes sessions. Binds to 127.0.0.1 only.
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
import { createImageResolver, real } from './src/local-files.mjs';
import { extractMediaTags, mediaKind } from './src/media-tags.mjs';
import { Inbox } from './src/inbox.mjs';
import { Push } from './src/push.mjs';
import { parseUserMessage, previewOf } from './src/user-markers.mjs';
import { Outbox, queuedRow } from './src/outbox.mjs';
import { callsOf, paseoItem, paseoTool } from './src/paseo-calls.mjs';
import QRCode from 'qrcode';

const cfg = loadConfig(process.argv.slice(2));
setLang(cfg.lang);
const TOKEN = cfg.token;
const PORT = cfg.port;
const HOST = cfg.host;
const HERMES_HOME = cfg.hermesHome;
// Real paths of files that stored assistant replies attached with MEDIA:<path>; filled by threadMessages().
const mediaFiles = new Set();
const resolveImage = createImageResolver({
  roots: [path.join(HERMES_HOME, 'cache'), cfg.paseoHome, ...cfg.imageRoots],
  tempPrefixes: ['paseo-attachments-'],
  files: mediaFiles,
});
const SYSTEM_SOURCES = new Set(['cron', 'tool', 'subagent', 'oneshot', 'webhook', 'kanban', 'api_server']);

const WEB_DIST = cfg.uiDir;

const store = new Store(path.join(HERMES_HOME, 'state.db'));
// Paseo is optional: HERMES_UI_PASEO=off, or simply no daemon running (it then stays disconnected quietly).
const paseo = new Paseo({ url: cfg.paseo.url, opsLoopFile: cfg.paseo.opsLoopFile, source: cfg.paseo.source, mcp: cfg.paseo.mcp, respond: cfg.paseo.respond });
const PASEO_ON = cfg.paseo.mode !== 'off';
const devices = new Devices(cfg.dataDir);
const inbox = new Inbox(cfg.dataDir, cfg.inbox);
const push = cfg.push.enabled ? new Push(cfg.dataDir, { subject: cfg.push.subject || (/^https:/.test(cfg.uiUrl) ? cfg.uiUrl : '') }) : null;
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
  remote.setAccess(devices.irohIds(), devices.pairingOpen());
};
setInterval(syncIrohAccess, 30000);
const board = new Board(cfg.dataDir);
const outbox = new Outbox(board);
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

// First prompt as the card shows it: the user's own words, or the title of a delivered event.
function cleanPrompt(text) {
  const p = previewOf(text);
  if (p.event) return p.text;
  const skill = p.text.match(/^⚡ Skill „[^“]+“/);
  return (skill ? skill[0] : p.text).replace(/^"|"$/g, '').trim();
}

// Latest user row is a delivered event (webhook, cron, background notice) newer than the last reply.
function eventActivity(row) {
  if (!row.last_user || (row.last_user_id ?? 0) <= (row.last_assistant_id ?? 0)) return '';
  const p = previewOf(row.last_user, { kind: row.last_user_kind });
  return p.event ? `🔔 ${p.route ? `${p.route}: ` : ''}${p.text}` : '';
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
    // Direct calls and calls through Hermes' tool_call wrapper alike.
    for (const { name, args } of [...callsOf(r.tool_calls).values()].flat()) {
      if (!paseoTool(name)) continue;
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
const sessionsOfAgent = (id) => {
  const sessions = new Set([...(agentSessions.get(id) || [])]);
  for (const [ref, set] of agentSessions) if (ref !== id && id.startsWith(ref)) set.forEach((s) => sessions.add(s));
  return sessions;
};
paseo.on('agent', (id) => {
  for (const sid of sessionsOfAgent(id)) pushCard(sid);
  observeAgent(id);
});
paseo.on('status', (ok) => { console.log(`paseo ${ok ? `connected (${paseo.sourceLabel})` : 'disconnected'}`); for (const sid of sessionAgents.keys()) pushCard(sid); });
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
  else if (eventActivity(row)) activity = eventActivity(row);
  else if (row.last_assistant) activity = `💬 ${clip(extractMediaTags(row.last_assistant).text, 180)}`;
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
    paseo: agents.map(({ id, title, state, status, rel, account, kind, archived, pendingPermissions, createdAt, updatedAt }) => ({ id, title, state, status, rel, account, kind, archived, pendingCount: pendingPermissions?.length || 0, createdAt, updatedAt })),
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
      observeCard(card);
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
      lv.error = p.error ? { at: Date.now(), text: clip(p.error, 300) } : null;
      for (const k of lv.prompts.keys()) settledElsewhere(k, 'expired');
      lv.prompts.clear(); // a finished turn has no open prompts (late *.settled may never come)
      pushInbox();
      setTimeout(() => { broadcast('reload', { id, final: true }); pushCard(id, true); }, 300);
      return;
    case 'approval.request':
    case 'clarify.request':
      if (p.prompt_id) {
        const pr = { kind: ev.type.split('.')[0], ...p, at: Date.now() };
        lv.prompts.set(p.prompt_id, pr);
        recordRequest(id, pr);
      }
      broadcast('reload', { id, final: false });
      break;
    case 'approval.settled':
    case 'clarify.settled':
      lv.prompts.delete(p.prompt_id);
      settledElsewhere(p.prompt_id);
      break;
    case 'approval.cancelled':
      for (const [k, v] of lv.prompts) if (v.kind === 'approval') { lv.prompts.delete(k); settledElsewhere(k, 'cancelled'); }
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
  for (const pr of lv.prompts.values()) recordRequest(id, pr);
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
      reconcileOutbox(id);
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
  const queued = new Map(outbox.forSession(id).filter((e) => e.rowId).map((e) => [e.rowId, e]));
  const calls = new Map(); // tool_call_id -> [{ name, args }], for Paseo items
  const seenCalls = new Map();
  const out = [];
  for (const r of rows) {
    if (r.display_kind === 'hidden') continue;
    if (r.role === 'assistant' && r.tool_calls) for (const [k, v] of callsOf(r.tool_calls)) calls.set(k, v);
    if (r.role === 'tool' && PASEO_ON) {
      // Paseo agent started / messaged / archived here: an inline card with live state (src/paseo-calls.mjs).
      const item = paseoItem(r, calls, seenCalls);
      if (item) {
        const agentId = paseo.resolve(item.ref) || (UUID.test(item.ref) && item.ref.length === 36 ? item.ref : null);
        if (agentId && !paseo.agents.has(agentId)) paseo.ensure(agentId);
        out.push({ id: r.id, role: 'paseo', text: '', ts: r.timestamp, paseo: { ...item, agentId } });
        continue;
      }
    }
    if (r.role === 'tool') {
      out.push({ id: r.id, role: 'tool', toolName: r.tool_name || 'Tool', text: clip(r.content, 4000), ts: r.timestamp });
      continue;
    }
    if (r.role === 'assistant' && !String(r.content || '').trim()) continue;
    if (r.role === 'user') {
      const p = parseUserMessage(r.content, { kind: r.display_kind, meta: r.display_metadata });
      if (p.type === 'event') {
        out.push({ id: r.id, role: 'event', text: p.text, ts: r.timestamp, event: p.event });
        continue;
      }
      const msg = { id: r.id, role: 'user', text: p.text, ts: r.timestamp, attachments: [], meta: p.meta };
      if (p.steer) msg.steer = true;
      if (p.threadContext) msg.threadContext = clip(p.threadContext, 6000);
      // Images, audio and documents Hermes stored for this turn are referenced by path in the text.
      for (const f of p.files) msg.attachments.push(fileAttachment(f));
      const hasImage = p.files.some((f) => f.kind === 'image');
      for (let i = media.length - 1; i >= 0; i--) {
        if (r.id > media[i].afterMsgId) {
          if (!(hasImage && media[i].kind === 'image')) msg.attachments.push(media[i]);
          media.splice(i, 1);
        }
      }
      // Still in Hermes' busy queue (accepted, runs after the current turn).
      if (queuedRow(r)) {
        const e = queued.get(r.id);
        msg.outbox = { id: e?.id || null, status: e?.status === 'lost' ? 'lost' : 'queued', mode: 'queued' };
      }
      out.push(msg);
      continue;
    }
    const msg = { id: r.id, role: r.role, text: r.content, ts: r.timestamp, attachments: [] };
    // Files Hermes sends along with a reply (Slack shows them as attachments); only these exact files
    // become readable through /api/hermes-file, nothing else in their directories.
    const { text, paths } = extractMediaTags(msg.text);
    msg.text = text;
    for (const file of paths) msg.attachments.push(fileAttachment({ kind: mediaKind(file), path: file }));
    out.push(msg);
  }
  // Sent from the board, not in the transcript yet (see src/outbox.mjs).
  const entries = outbox.forSession(id);
  for (const e of entries) {
    if (e.rowId && rows.some((r) => r.id === e.rowId)) continue;
    out.push({ role: 'user', text: e.text, ts: e.ts, attachments: e.attachments || [], outbox: { id: e.id, status: e.status, mode: e.mode, error: e.error } });
  }
  // Waiting in Hermes' FIFO from another client (Slack, desktop app): shown, not editable here.
  const mine = new Set(entries.map((e) => e.admissionId).filter(Boolean));
  for (const a of store.admissions(id)) {
    if (a.status !== 'queued' || mine.has(a.admission_id) || !a.text) continue;
    const p = parseUserMessage(a.text);
    if (p.type === 'event') continue;
    out.push({ role: 'user', text: p.text, meta: p.meta, attachments: [], outbox: { id: null, status: 'queued' } });
  }
  return out;
}

// A file referenced by path in a transcript: images through the image resolver, audio only as this
// exact file (like MEDIA attachments), anything else just by name.
function fileAttachment(f) {
  if (f.kind === 'file') return { kind: 'file', name: f.name || path.basename(f.path) };
  if (f.kind === 'audio') {
    const resolved = real(f.path);
    if (!resolved || mediaKind(f.path) !== 'audio') return { kind: 'file', name: f.name || path.basename(f.path) };
    mediaFiles.add(resolved);
  } else if (f.kind !== 'image') {
    return { kind: 'file', name: path.basename(f.path) };
  } else {
    const resolved = real(f.path);
    if (resolved) mediaFiles.add(resolved);
  }
  return { kind: f.kind, url: `/api/hermes-file?path=${encodeURIComponent(f.path)}` };
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
  // Mid-turn the message waits in Hermes' queue: keep showing what the running turn does.
  if (!sessionRunning(id, row)) {
    lv.running = true;
    lv.activity = t('started');
  }
  lv.at = Date.now();
  // A new turn always releases a manual column (incl. Done).
  delete board.data.overrides[id];
  const sent = body || t('seeAttachment');
  // Kept until Hermes writes the message to the transcript (mid-turn messages land there late, or never).
  const afterSeq = store.admissions(id, 1).at(-1)?.seq || 0;
  const entry = outbox.add(id, { text: sent, afterMsgId, afterSeq, attachments: media.filter((x) => x.afterMsgId === afterMsgId) });
  let admission;
  try {
    admission = await gateway.submit(id, { text: sent, attachments, voice: !!audio });
  } catch (err) {
    outbox.update(entry.id, { status: 'failed', error: err.message });
    broadcast('reload', { id, final: false });
    throw err;
  }
  // queued (+ admission_id) = after the running turn, in Hermes' FIFO; streaming = started a turn now;
  // redirected / steered = into the running turn (sessions the desktop backend runs itself).
  outbox.update(entry.id, { status: 'waiting', mode: admission?.status || null, ...(admission?.admission_id ? { admissionId: admission.admission_id } : {}) });
  if (admission?.execution_generation != null) lv.generation = admission.execution_generation;
  reconcileOutbox(id);
  pushCard(id, true);
  broadcast('reload', { id, final: false });
  return { body, admission, entry: outbox.get(entry.id) || { ...entry, status: 'delivered' } };
}

function sessionRunning(id, row = store.getSession(id)) {
  const lv = live.get(id);
  return lv?.running === true || (!!(row?.admitted || row?.leased) && lv?.running !== false);
}

function reconcileOutbox(id) {
  const open = outbox.forSession(id);
  if (!open.length) return false;
  const since = Math.min(...open.map((e) => e.afterMsgId ?? 0));
  const changed = outbox.reconcile(id, store.userRowsSince(id, since), store.admissions(id), sessionRunning(id));
  if (changed) broadcast('reload', { id, final: false });
  return changed;
}
// Sessions with open entries are re-checked even when nothing changes in state.db ("lost" after a Stop).
setInterval(() => {
  for (const id of new Set(outbox.list.map((e) => e.sessionId))) {
    try { reconcileOutbox(id); } catch (err) { console.error('outbox', err.message); }
  }
}, 5000);

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

// ---------- inbox + notifications (across all chats) ----------
// Open requests ("needs you") are derived live: Hermes approvals/clarify questions of every followed
// session, and Paseo agents with a pending permission. The history (data/inbox.json) records what
// happened: requests and how they were answered, finished turns, errors, Paseo agents done/failed.
const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const sessionTitle = (sid) => {
  const row = sid && store.getSession(sid);
  return row ? (row.title || clip(cleanPrompt(row.first_prompt), 70) || t('newSession')) : null;
};
// The chat an agent belongs to: the one that started it, else one that steers it, else any.
function chatOfAgent(agentId) {
  let best = null;
  for (const sid of sessionsOfAgent(agentId)) {
    for (const [ref, { rel }] of sessionAgents.get(sid) || []) {
      if (ref !== agentId && !agentId.startsWith(ref)) continue;
      if (!best || REL_RANK[rel] > REL_RANK[best.rel]) best = { sid, rel };
    }
  }
  return best?.sid || null;
}

function openItems() {
  const out = [];
  for (const [sid, lv] of live) {
    if (!lv.prompts?.size) continue;
    const title = sessionTitle(sid);
    if (!title) continue;
    for (const pr of lv.prompts.values()) {
      out.push({ key: `req:${pr.prompt_id}`, source: 'hermes', kind: pr.kind, sessionId: sid, title, at: (pr.at || Date.now()) / 1000, prompt: promptView(pr) });
    }
  }
  if (paseo.connected) {
    for (const [id, a] of paseo.agents) {
      if (a.archivedAt || !(a.pendingPermissions || []).length) continue;
      const v = paseo.view(id);
      const sid = chatOfAgent(id);
      for (const perm of v.pendingPermissions) {
        if (!perm.id) continue;
        const seen = inbox.get(`perm:${perm.id}`);
        out.push({
          key: `perm:${perm.id}`, source: 'paseo', kind: 'permission', sessionId: sid, title: sid ? sessionTitle(sid) : null,
          at: seen?.at || Date.parse(a.updatedAt || '') / 1000 || Date.now() / 1000,
          agent: { id, title: v.title, account: v.account, cwd: v.cwd, deepLink: v.deepLink },
          permission: perm,
          canRespond: paseo.canRespond,
        });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
const badgeCount = () => openItems().length + inbox.unread();
let inboxTimer = null;
function pushInbox() {
  clearTimeout(inboxTimer);
  inboxTimer = setTimeout(() => broadcast('inbox', { open: openItems(), unread: inbox.unread() }), 150);
}
inbox.on('item', (item) => { broadcast('inbox-item', item); pushInbox(); });

// Push to the paired devices' browsers. The payload carries no content: chat title + what happened.
function notify(ev) {
  if (!push) return;
  push.notify({ ...ev, badge: badgeCount() }).catch((err) => console.warn('push', err.message));
}

function recordRequest(sid, pr) {
  if (!pr?.prompt_id || inbox.has(`req:${pr.prompt_id}`)) return;
  const title = sessionTitle(sid) || t('newSession');
  const v = promptView(pr);
  const item = inbox.add({
    id: `req:${pr.prompt_id}`, kind: pr.kind, source: 'hermes', sessionId: sid, title,
    text: truncate(pr.kind === 'approval' ? [v.description, v.command].filter(Boolean).join(' · ') : v.question, 400),
  });
  pushInbox();
  if (!item) return;
  notify({
    category: 'approval', source: 'hermes', title, body: pr.kind === 'approval' ? t('nApproval') : t('nClarify'),
    tag: `req:${pr.prompt_id}`, url: `#/inbox/${encodeURIComponent(sid)}`, ttl: Math.max(60, Number(pr.timeout_s) || 300),
    ...(pr.kind === 'approval' && v.choices.includes('deny') ? {
      actions: [{ action: 'allow', title: t('nAllow') }, { action: 'deny', title: t('nDeny') }],
      confirm: { promptId: pr.prompt_id, allow: v.choices.find((c) => c !== 'deny') || 'once' },
    } : {}),
  });
}
// Answered in Slack/the desktop app, cancelled, or timed out. Our own answers are recorded first by
// /respond; the short delay lets that win when the settled event overtakes the HTTP response.
function settledElsewhere(promptId, how = 'elsewhere') {
  if (!promptId) return;
  setTimeout(() => { inbox.resolve(`req:${promptId}`, { by: how }); pushInbox(); }, 1500);
}

// T5: a Hermes chat counts as done only when Hermes' turn is over and none of the Paseo agents it
// started or steers is still running or waiting for a permission (same rule as the board's columns).
const busyState = new Map(); // sessionId -> boolean
function observeCard(card) {
  if (card.system || card.draft) return;
  const owned = (card.paseo || []).filter((a) => a.rel !== 'watches' && !a.archived);
  const busy = card.running || card.pending.length > 0 || owned.some((a) => a.state === 'running' || a.state === 'needs-attention');
  const was = busyState.get(card.id);
  busyState.set(card.id, busy);
  if (!was || busy) return;
  const row = store.getSession(card.id);
  const lv = live.get(card.id);
  const failed = lv?.error && Date.now() - lv.error.at < 120000;
  const item = inbox.add({
    id: `${failed ? 'error' : 'done'}:${card.id}:${row?.last_msg_id ?? Date.now()}`,
    kind: failed ? 'error' : 'done', source: 'hermes', sessionId: card.id, title: card.title,
    text: truncate(failed ? lv.error.text : card.activity.replace(/^💬\s*/, ''), 300),
  });
  if (item) notify({ category: failed ? 'error' : 'done', source: 'hermes', title: card.title, body: failed ? t('nError') : t('nDone'), tag: `chat:${card.id}`, url: `#/board/${encodeURIComponent(card.id)}`, ttl: 86400 });
}

// Paseo agents: permission requested/resolved, turn finished, failed or hit a usage limit.
const agentPrev = new Map(); // agentId -> { state, perms: Set<requestId> }
const LIMIT_RE = /limit|quota|rate.?limit|usage|credit|overloaded|429/i;
function observeAgent(id) {
  const v = paseo.view(id);
  if (!v.known) return;
  const prev = agentPrev.get(id);
  const perms = new Set((v.pendingPermissions || []).map((p) => p.id).filter(Boolean));
  agentPrev.set(id, { state: v.state, perms });
  const sid = chatOfAgent(id);
  const title = v.title || id.slice(0, 8);
  const base = { source: 'paseo', agentId: id, agentTitle: title, sessionId: sid, title: sid ? sessionTitle(sid) : title };
  const url = sid ? `#/inbox/${encodeURIComponent(sid)}` : '#/inbox';
  let changed = false;
  if (perms.size && v.pendingPermissions.some((p) => p.id && !p.description && !p.command)) {
    paseo.permissionDetails(id).then((ok) => {
      if (!ok) return;
      for (const p of paseo.view(id).pendingPermissions || []) {
        const item = p.id && inbox.get(`perm:${p.id}`);
        const text = truncate([p.title || p.name, p.description, p.command].filter(Boolean).join(' · '), 400);
        if (item && item.text !== text) inbox.update(item.id, { text });
      }
      pushInbox();
    });
  }
  for (const p of v.pendingPermissions || []) {
    if (!p.id || prev?.perms.has(p.id)) continue;
    changed = true;
    const item = inbox.add({ ...base, id: `perm:${p.id}`, kind: 'permission', text: truncate([p.title || p.name, p.description, p.command].filter(Boolean).join(' · '), 400) });
    if (item) notify({ category: 'approval', source: 'paseo', title, body: t('nPaseoPermission'), tag: `perm:${p.id}`, url, ttl: 3600 });
  }
  for (const rid of prev?.perms || []) {
    if (perms.has(rid)) continue;
    changed = true;
    setTimeout(() => { inbox.resolve(`perm:${rid}`, { by: 'elsewhere' }); pushInbox(); }, 1500);
  }
  if (prev && prev.state === 'running' && v.state !== 'running' && !v.archived) {
    const limit = v.state === 'error' && LIMIT_RE.test(v.lastError || '');
    const kind = v.state === 'error' ? (limit ? 'paseo-limit' : 'paseo-error') : (v.state === 'finished' || v.state === 'idle') ? 'paseo-done' : null;
    if (kind) {
      const item = inbox.add({ ...base, id: `${kind}:${id}:${v.updatedAt || Date.now()}`, kind, text: truncate(v.lastError || v.goal || '', 300) });
      if (item) notify({ category: kind === 'paseo-done' ? 'done' : 'error', source: 'paseo', title, body: t({ 'paseo-done': 'nPaseoDone', 'paseo-error': 'nPaseoError', 'paseo-limit': 'nPaseoLimit' }[kind]), tag: `agent:${id}`, url, ttl: 86400 });
    }
  }
  if (changed) pushInbox();
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
      if (!cfg.ui) return send(res, 404, { error: 'headless: UI disabled (HERMES_UI_SERVE_UI=off)' });
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
      if (auth.device) { devices.revoke(auth.device.id); push?.removeDevice(auth.device.id); }
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
      push?.removeDevice(decodeURIComponent(m0[1]));
      syncIrohAccess();
      broadcast('devices', devices.list());
      return send(res, 200, { ok: true, devices: devices.list() });
    }

    // ---- inbox ----
    if (p === '/api/inbox' && req.method === 'GET') {
      const before = Number(url.searchParams.get('before')) || Infinity;
      return send(res, 200, { open: openItems(), items: inbox.list({ before, limit: 300 }), unread: inbox.unread(), paseo: { connected: paseo.connected, canRespond: paseo.canRespond } });
    }
    if (p === '/api/inbox/read' && req.method === 'POST') {
      const { ids } = await readJson(req);
      const changed = inbox.markRead(ids === 'all' ? 'all' : Array.isArray(ids) ? ids.map(String) : []);
      broadcast('inbox-read', { ids: ids === 'all' ? 'all' : changed });
      pushInbox();
      return send(res, 200, { ok: true, unread: inbox.unread() });
    }
    if ((m0 = p.match(/^\/api\/paseo\/agents\/([0-9a-f-]{36})\/permissions\/([^/]+)$/)) && req.method === 'POST') {
      const [, agentId, rid] = m0.map(decodeURIComponent);
      const { decision, message } = await readJson(req);
      if (!['allow', 'deny'].includes(decision)) return send(res, 400, { error: 'decision must be allow or deny' });
      const a = paseo.agents.get(agentId);
      if (!a || !(a.pendingPermissions || []).some((x) => x.id === rid)) return send(res, 409, { error: t('promptGone') });
      if (!inbox.has(`perm:${rid}`)) observeAgent(agentId);
      const who = auth.device?.name || auth.via;
      console.log(`paseo permission ${rid} of agent ${agentId}: ${decision} by ${who}`);
      const result = await paseo.respondPermission(agentId, rid, decision, decision === 'deny' ? String(message || '').slice(0, 500) || undefined : undefined);
      inbox.resolve(`perm:${rid}`, { by: 'ui', decision, device: who });
      pushInbox();
      return send(res, 200, { ok: true, result });
    }

    // ---- web push ----
    if (p.startsWith('/api/push')) {
      if (!push) return send(res, 404, { error: 'push disabled (HERMES_UI_PUSH=off)' });
      const deviceKey = auth.device?.id || auth.via;
      const deviceName = auth.device?.name || 'Browser';
      if (p === '/api/push' && req.method === 'GET') return send(res, 200, { publicKey: push.publicKey, subscriptions: push.forDevice(deviceKey) });
      const body = await readJson(req);
      if (p === '/api/push/subscribe' && req.method === 'POST') return send(res, 200, push.subscribe(deviceKey, deviceName, body.subscription, body.settings));
      if (p === '/api/push/settings' && req.method === 'POST') {
        const settings = push.updateSettings(deviceKey, body.endpoint, body.settings || {});
        return settings ? send(res, 200, { settings }) : send(res, 404, { error: 'subscription not found' });
      }
      if (p === '/api/push/unsubscribe' && req.method === 'POST') { push.unsubscribe(deviceKey, body.endpoint); return send(res, 200, { ok: true }); }
      if (p === '/api/push/test' && req.method === 'POST') {
        if (!push.forDevice(deviceKey).some((x) => x.endpoint === body.endpoint)) return send(res, 404, { error: 'subscription not found' });
        const sent = await push.notify({ category: 'done', source: 'hermes', title: 'Hermes UI', body: t('nTestBody'), tag: 'test', url: '#/inbox', badge: badgeCount(), ttl: 120 }, { only: body.endpoint });
        return send(res, sent ? 200 : 502, sent ? { ok: true } : { error: 'push service refused the message' });
      }
      if (p === '/api/push/presence' && req.method === 'POST') { push.setPresence(deviceKey, body.visible); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'not found' });
    }

    if (p === '/api/events') {
      // X-Accel-Buffering: tunnels must not buffer the stream.
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: gateway\ndata: ${JSON.stringify({ connected: gateway.connected })}\n\n`);
      res.write(`event: remote\ndata: ${JSON.stringify(remoteView())}\n\n`);
      res.write(`event: inbox\ndata: ${JSON.stringify({ open: openItems(), unread: inbox.unread() })}\n\n`);
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

    if (p === '/api/file' || p === '/api/hermes-file') {
      // Images referenced by local path in transcripts and MEDIA attachments; see src/local-files.mjs.
      const img = resolveImage(url.searchParams.get('path'));
      if (!img) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.size, 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox", ...SECURITY_HEADERS });
      return fs.createReadStream(img.file).pipe(res);
    }

    if (p === '/api/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').slice(0, 200);
      const { title, content } = store.search(q, { includeArchived: url.searchParams.get('archived') === '1', limit: 30 });
      const card = (id) => {
        const row = store.getSession(id);
        return row && !isEmptyShell(row) ? { ...toCard(row), archived: !!row.archived, messageCount: row.message_count || 0 } : null;
      };
      const byTitle = title.map((id) => { const c = card(id); return c && { session: c }; }).filter(Boolean);
      const titled = new Set(title);
      const byContent = content.map((h) => {
        const c = card(h.id);
        const role = h.role === 'user' && previewOf(h.head, { kind: h.kind }).event ? 'event' : h.role;
        return c && { session: c, hit: { msgId: h.msg_id, role, ts: h.ts, snippet: h.snip, hits: h.hits }, alsoTitle: titled.has(h.id) };
      }).filter(Boolean);
      return send(res, 200, { q, title: byTitle, content: byContent });
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
      reconcileOutbox(id); // a message that just landed in the transcript must not show twice
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
      try {
        await sendPrompt(id, body);
      } catch (err) {
        // The message stays in the thread as failed, with "send again".
        return send(res, 502, { error: err.message, session: cardById(id), messages: threadMessages(id) });
      }
      return send(res, 200, { session: cardById(id), messages: threadMessages(id) });
    }

    if ((m = p.match(/^\/api\/outbox\/([0-9a-f-]{36})(\/retry)?$/)) && (req.method === 'DELETE' || (m[2] && req.method === 'POST'))) {
      const e = outbox.get(m[1]);
      if (!e) return send(res, 404, { error: 'not found' });
      outbox.remove(e.id);
      if (m[2]) {
        // Images go again from the board's own copy (data/media); the text is what was sent before.
        const images = (e.attachments || []).filter((x) => x.kind === 'image').map((x) => {
          const file = board.mediaPath(...x.url.split('/').slice(-2).map(decodeURIComponent));
          return file && fs.existsSync(file) ? { name: path.basename(file), type: MEDIA[path.extname(file)] || 'image/png', data: fs.readFileSync(file).toString('base64') } : null;
        }).filter(Boolean);
        const text = images.length && e.text === t('seeAttachment') ? '' : e.text;
        try { await sendPrompt(e.sessionId, { text, images }); } catch (err) {
          return send(res, 502, { error: err.message, session: cardById(e.sessionId), messages: threadMessages(e.sessionId) });
        }
      }
      broadcast('reload', { id: e.sessionId, final: false });
      return send(res, 200, { session: cardById(e.sessionId), messages: threadMessages(e.sessionId) });
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
      return send(res, 200, { connected: paseo.connected, source: paseo.sourceLabel, agents: paseoFor(id) });
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
      recordRequest(id, pr); // in case it was never recorded (e.g. answered right after a restart)
      inbox.resolve(`req:${promptId}`, { by: 'ui', device: auth.device?.name || auth.via, ...(pr.kind === 'approval' ? { choice } : { answer: clip(Array.isArray(answers) ? answers.join(', ') : answer ?? '', 200) }) });
      console.log(`hermes ${pr.kind} ${promptId} in ${id}: ${pr.kind === 'approval' ? choice : 'answered'} by ${auth.device?.name || auth.via}`);
      pushCard(id, true);
      pushInbox();
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
  console.log(`Hermes UI API on http://${HOST}:${PORT}/api${cfg.ui ? ` · UI on http://${HOST}:${PORT}/` : ' (headless)'} · token: HERMES_UI_TOKEN in ${cfg.envFile}`);
  gateway.connect();
  syncIrohAccess();
  remote.start();
  if (PASEO_ON) {
    scanPaseoRefs();
    paseo.connect();
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { remote.stop(); process.exit(0); });
