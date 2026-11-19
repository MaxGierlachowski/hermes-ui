// User-role rows in state.db carry more than what the user typed: Hermes wraps gateway input in
// markers (origin JSON, reply quotes, Slack thread context, steer envelopes) and stores webhook/cron
// deliveries, background-process and delegation notices as user messages too. This turns one row
// into what the thread shows: the user's own text plus small meta lines and attachments, or an
// "event" (not written by the user) with a route and a title.
// Formats as stored by Hermes (gateway/run.py, gateway/platforms/*), checked against state.db.

const SENDER_RE = /^\[[^\]\n|]+ \| [A-Za-z]+ user <@[\w.-]+>\]\s*/;
const DELIVERY_RE = /^\[(Webhook|Cron) delivery: ([^\]\n]+)\]\s*\n?/;
const STEER_OPEN_RE = /^\[OUT-OF-BAND USER MESSAGE[^\n]*\]\n?/;
const STEER_CLOSE_RE = /\n?\[\/OUT-OF-BAND USER MESSAGE\]\s*$/;
const ORIGIN_RE = /Gateway message origin \(JSON data[^\n]*\n(\{[^\n]*\})\n?(?:Do not guess a reply destination[^\n]*\n?)?/;
const THREAD_RE = /^\[Thread context[^\n]*\]\n([\s\S]*?)\n\[End of thread context\]\s*(?:\[New message\]\s*)?/;
const REPLY_RE = /^\[Replying to: "([\s\S]*?)"\]\s*/;
const SLACK_CTX_RE = /^\[Slack app context: [^\]\n]*\]\s*/;
const SKILL_RE = /^\[IMPORTANT: The user has invoked the "([^"]+)" skill/;

// Notices Hermes delivers as a user turn (display_kind, or the text prefix for older rows).
const NOTICE_KINDS = { internal_notification: 'process', process_complete: 'process', async_delegation_complete: 'delegation' };
const NOTICE_PREFIXES = [
  [/^\[IMPORTANT: (?:Background process|\d+ background process results)/, 'process'],
  [/^\[ASYNC DELEGATION (?:BATCH )?COMPLETE/, 'delegation'],
  [/^\[CONTEXT COMPACTION/, 'compaction'],
  [/^\[IMPORTANT: You are running as a scheduled cron job/, 'scheduled'],
];

const FILE_MARKERS = [
  // [User sent audio: /path/audio.m4a]
  [/\n*\[User sent audio: ([^\]\n]+)\]/g, (m) => ({ kind: 'audio', path: m[1] })],
  // [The user sent an audio file attachment: 'x.ogg'. It is saved at: /path. …]
  [/\n*\[The user sent an audio file attachment: '([^'\n]*)'\. It is saved at: (\S+?)\.?(?:\s[^\]]*)?\]/g, (m) => ({ kind: 'audio', name: m[1], path: m[2] })],
  // [The user sent a document: 'x.pdf'. It is saved at: /path. …]
  [/\n*\[The user sent a document: '([^'\n]*)'\. It is saved at: (\S+?)\.?(?:\s[^\]]*)?\]/g, (m) => ({ kind: 'file', name: m[1], path: m[2] })],
  // [voice message could not be transcribed automatically; the audio is available at: /path]
  [/\n*\[voice message could not be transcribed[^\]\n]*?: (\S+?)\]/g, (m) => ({ kind: 'audio', path: m[1], note: 'untranscribed' })],
  // [Sprachnachricht konnte nicht transkribiert werden. Audiodatei: /path]  (this board, older builds)
  [/\n*\[Sprachnachricht konnte nicht transkribiert werden\. Audiodatei: (\S+?)\]/g, (m) => ({ kind: 'audio', path: m[1], note: 'untranscribed' })],
  // [Image attached at: /path]
  [/\n*\[Image attached at: ([^\]\n]+)\]/g, (m) => ({ kind: 'image', path: m[1] })],
];

const plain = (s) => String(s ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^\s*#+\s+/gm, '').replace(/^\s*[-*]\s+/gm, '');
const oneLine = (s, n) => {
  const t = plain(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** First Markdown heading, else the first non-empty line. */
export function titleOf(body, n = 120) {
  const text = String(body ?? '');
  const heading = text.match(/^\s*#{1,6}\s+(.+)$/m);
  const line = heading ? heading[1] : text.split('\n').find((l) => l.trim()) || '';
  return oneLine(line, n);
}

function parseMeta(raw) {
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
}

/**
 * @param {string} content       messages.content
 * @param {{ kind?: string|null, meta?: string|object|null }} [o]  display_kind / display_metadata
 * @returns {{ type: 'user'|'event', text: string, meta: {kind: string, text: string}[], files: {kind: string, path: string, name?: string, note?: string}[],
 *   event?: { source: string, route?: string, title: string }, steer?: boolean, threadContext?: string }}
 */
export function parseUserMessage(content, { kind = null, meta = null } = {}) {
  let t = String(content ?? '').replace(/\r\n/g, '\n');
  const out = { type: 'user', text: '', meta: [], files: [] };

  const delivery = t.match(DELIVERY_RE);
  if (delivery) {
    const body = t.slice(delivery[0].length).trim();
    return { ...out, type: 'event', text: body, event: { source: delivery[1].toLowerCase(), route: delivery[2].trim(), title: titleOf(body) || delivery[2].trim() } };
  }

  t = t.replace(SENDER_RE, '');
  const noticeSource = NOTICE_KINDS[kind] || NOTICE_PREFIXES.find(([re]) => re.test(t))?.[1];
  if (noticeSource) {
    const m = parseMeta(meta);
    const head = t.match(/^\[([^\]\n]+)\]?/)?.[1] || t;
    const title = oneLine(m.display_text || head.replace(/^IMPORTANT:\s*/, ''), 120);
    return { ...out, type: 'event', text: t.trim(), event: { source: noticeSource, title } };
  }

  if (kind === 'steer' || STEER_OPEN_RE.test(t)) {
    out.steer = true;
    t = t.replace(STEER_OPEN_RE, '').replace(STEER_CLOSE_RE, '');
  }

  const origin = t.match(ORIGIN_RE);
  if (origin) {
    t = t.replace(ORIGIN_RE, '');
    try {
      const o = JSON.parse(origin[1]);
      const where = [o.platform, o.chat_type].filter(Boolean).join(' · ');
      if (where) out.meta.push({ kind: 'origin', text: where });
    } catch { /* not JSON: drop the block anyway */ }
  }
  t = t.trimStart();

  // Prefixes come in any order (thread context, reply quote, sender, Slack app context); peel them off.
  for (let guard = 0; guard < 6; guard++) {
    const before = t;
    const thread = t.match(THREAD_RE);
    if (thread) { out.threadContext = thread[1].trim(); t = t.slice(thread[0].length); }
    const reply = t.match(REPLY_RE);
    if (reply) { out.meta.push({ kind: 'reply', text: oneLine(reply[1], 160) }); t = t.slice(reply[0].length); }
    t = t.replace(SENDER_RE, '').replace(SLACK_CTX_RE, '');
    if (t === before) break;
  }

  for (const [re, make] of FILE_MARKERS) {
    t = t.replace(re, (...args) => {
      const m = args.slice(0, -2);
      const f = make(m);
      out.files.push(f);
      return '';
    });
  }
  t = t.replace(/\n*\[screenshot\]\s*$/, '');

  const skill = t.match(SKILL_RE);
  if (skill) {
    const userPart = t.split(/\n---\n/).pop();
    t = `⚡ Skill „${skill[1]}“${userPart && userPart !== t && userPart.length < 4000 ? `\n\n${userPart}` : ''}`;
  }

  out.text = t.trim();
  return out;
}

/** One line for card previews and the board title: the user's text, or the event title. */
export function previewOf(content, o) {
  const p = parseUserMessage(content, o);
  if (p.type === 'event') return { event: true, text: p.event.title, source: p.event.source, route: p.event.route };
  const files = p.files.map((f) => (f.kind === 'image' ? '🖼' : f.kind === 'audio' ? '🎙' : '📎')).join(' ');
  return { event: false, text: [p.text, files].filter(Boolean).join(' ') };
}
