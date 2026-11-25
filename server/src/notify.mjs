// POST /api/notify: a free message from a script, another Hermes profile or anything else on this
// machine (the replacement for posting to a chat channel). parseNotify() validates the request body and
// turns it into an inbox entry of kind 'automation' with source 'notify', grouped by `group`.

import crypto from 'node:crypto';

export const NOTIFY_MAX_BYTES = 64 * 1024;
const LEVELS = ['info', 'warn', 'error'];
const SESSION_RE = /^[\w.:-]{1,200}$/;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const plain = (s) => s.replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^\s*#+\s+/gm, '').replace(/^\s*[-*>]\s+/gm, '');

/** One line for the list: Markdown removed, whitespace folded, at most n characters. */
export function previewText(s, n = 300) {
  const t = plain(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * @param {unknown} body  parsed JSON: { title, text?, group?, level?, sessionId?, url? }
 * @returns the inbox entry (without read/at, which Inbox.add() sets). Throws with .status 400 when invalid.
 */
export function parseNotify(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a JSON object');
  const { title, text = '', group, level = 'info', sessionId, url } = body;
  if (typeof title !== 'string' || !title.trim()) throw bad('title is required');
  if (title.length > 200) throw bad('title is longer than 200 characters');
  if (typeof text !== 'string') throw bad('text must be a string');
  if (text.length > 8000) throw bad('text is longer than 8000 characters');
  if (group != null && (typeof group !== 'string' || group.length > 80)) throw bad('group must be a string of at most 80 characters');
  if (!LEVELS.includes(level)) throw bad(`level must be one of ${LEVELS.join(', ')}`);
  if (sessionId != null && sessionId !== '' && (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId))) throw bad('sessionId is not a valid session id');
  let link;
  if (url != null && url !== '') {
    if (typeof url !== 'string' || url.length > 2000) throw bad('url must be a string of at most 2000 characters');
    let u;
    try { u = new URL(url); } catch { throw bad('url is not a valid URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('url must be http or https');
    link = u.href;
  }
  const body_ = text.trim();
  return {
    id: `notify:${crypto.randomUUID()}`,
    kind: 'automation',
    source: 'notify',
    group: group?.trim() || 'notify',
    status: level === 'error' ? 'error' : 'ok',
    level,
    title: title.trim(),
    text: previewText(body_),
    body: body_,
    ...(link ? { link } : {}),
    sessionId: sessionId || null,
  };
}

/** Reads a request body of at most NOTIFY_MAX_BYTES as JSON (413 when larger, 400 when not JSON). */
export async function readNotifyBody(req) {
  const declared = Number(req.headers['content-length']);
  if (declared > NOTIFY_MAX_BYTES) throw Object.assign(new Error('payload too large'), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > NOTIFY_MAX_BYTES) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(c);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw bad('body is not valid JSON'); }
}
