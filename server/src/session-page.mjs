// GET /api/sessions: one page of board cards. The newest real chats come first; cron and other
// system sessions only with `system=1`. Filtering happens in SQL before the LIMIT (store.listSessions),
// and further pages follow a keyset cursor "<effective ts>:<session id>" (nextCursor, null = end).
// Pinned cards (created on the board, moved by hand) and drafts come with the first page only and are
// never part of the paged stream, so a later page cannot repeat them.

export const DEFAULT_LIMIT = 50;
// Clients from before pagination send no limit and never ask for a second page: give them more.
export const LEGACY_LIMIT = 200;
export const MAX_LIMIT = 200;

export function formatCursor(row) {
  return `${row.effective_at}:${row.id}`;
}

export function parseCursor(raw) {
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  const ts = Number(raw.slice(0, i));
  const id = raw.slice(i + 1);
  return Number.isFinite(ts) && id ? { ts, id } : null;
}

/**
 * @param {URLSearchParams} q  limit, before, system=1, days (optional time window, 0 = none)
 * @param {object} ctx  store, systemSources, pinnedIds, drafts (already as cards), toCard, isEmptyShell
 */
export function sessionPage(q, { store, systemSources, pinnedIds = [], drafts = [], toCard, isEmptyShell = () => false, now = Date.now() / 1000 }) {
  const system = q.get('system') === '1';
  const rawLimit = Number(q.get('limit'));
  const limit = q.has('limit') && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : (q.has('limit') ? DEFAULT_LIMIT : LEGACY_LIMIT);
  const days = Math.min(Number(q.get('days')) || 0, 3650);
  const sinceTs = days > 0 ? now - days * 86400 : null;
  const before = parseCursor(q.get('before'));
  if (q.get('before') && !before) throw Object.assign(new Error('invalid cursor'), { status: 400 });

  const keep = (c) => system || !c.system;
  const rows = store.listSessions({ limit, before, sinceTs, system, systemSources: [...systemSources], excludeIds: pinnedIds, now });
  const cards = rows.filter((r) => !isEmptyShell(r)).map(toCard).filter(keep);
  const nextCursor = rows.length === limit ? formatCursor(rows[rows.length - 1]) : null;
  if (before) return { sessions: cards, nextCursor };

  const pinned = store.sessionsByIds(pinnedIds).filter((r) => !isEmptyShell(r)).map(toCard).filter(keep);
  return { sessions: [...drafts, ...pinned, ...cards], nextCursor };
}
