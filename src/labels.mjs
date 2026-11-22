// Labels: a managed set (name + color, like GitHub issue labels) that any card can carry zero or more
// of, to slice the one board by project or context. Board state like column overrides, so it lives in
// data/board.json next to them: board.data.labels = [{ id, name, color }] (in display order) and
// board.data.cardLabels = { sessionId: [labelId, …] }. Deleting a label removes it from every card.

import crypto from 'node:crypto';

export const LABEL_COLORS = ['#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
const COLOR_RE = /^#[0-9a-f]{6}$/;
const MAX_NAME = 40;
const MAX_LABELS = 100;

const fail = (status, message) => Object.assign(new Error(message), { status });
const cleanName = (name) => String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
function cleanColor(color, fallback) {
  const c = String(color ?? '').trim().toLowerCase();
  if (!c) return fallback;
  if (!COLOR_RE.test(c)) throw fail(400, 'color must be #rrggbb');
  return c;
}

export class Labels {
  /** @param {{ data: object, save: () => void }} board */
  constructor(board) {
    this.board = board;
    board.data.labels ||= [];
    board.data.cardLabels ||= {};
  }

  get data() { return this.board.data; }

  list() { return this.data.labels.map((l) => ({ ...l })); }
  get(id) { return this.data.labels.find((l) => l.id === id) || null; }

  /** Label ids of a card, in the order of the managed list (unknown ids never leak out). */
  forCard(cardId) {
    const ids = this.data.cardLabels[cardId];
    if (!ids?.length) return [];
    const order = new Map(this.data.labels.map((l, i) => [l.id, i]));
    return ids.filter((id) => order.has(id)).sort((a, b) => order.get(a) - order.get(b));
  }

  #nameTaken(name, exceptId = null) {
    const key = name.toLowerCase();
    return this.data.labels.some((l) => l.id !== exceptId && l.name.toLowerCase() === key);
  }

  create({ name, color } = {}) {
    const n = cleanName(name);
    if (!n) throw fail(400, 'name required');
    if (this.#nameTaken(n)) throw fail(409, 'a label with this name exists');
    if (this.data.labels.length >= MAX_LABELS) throw fail(400, 'too many labels');
    // No color given: the next preset in turn, so a few quick labels are told apart at once.
    const label = { id: crypto.randomUUID(), name: n, color: cleanColor(color, LABEL_COLORS[this.data.labels.length % LABEL_COLORS.length]) };
    this.data.labels.push(label);
    this.board.save();
    return { ...label };
  }

  update(id, { name, color } = {}) {
    const label = this.get(id);
    if (!label) throw fail(404, 'label not found');
    if (name !== undefined) {
      const n = cleanName(name);
      if (!n) throw fail(400, 'name required');
      if (this.#nameTaken(n, id)) throw fail(409, 'a label with this name exists');
      label.name = n;
    }
    if (color !== undefined) label.color = cleanColor(color, label.color);
    this.board.save();
    return { ...label };
  }

  /** Removes the label and every assignment of it; returns the ids of the cards that lost it. */
  remove(id) {
    const i = this.data.labels.findIndex((l) => l.id === id);
    if (i < 0) throw fail(404, 'label not found');
    this.data.labels.splice(i, 1);
    const touched = [];
    for (const [card, ids] of Object.entries(this.data.cardLabels)) {
      if (!ids.includes(id)) continue;
      touched.push(card);
      const rest = ids.filter((x) => x !== id);
      if (rest.length) this.data.cardLabels[card] = rest;
      else delete this.data.cardLabels[card];
    }
    this.board.save();
    return touched;
  }

  /** Replaces a card's labels; unknown ids are rejected, duplicates dropped, [] clears. */
  setCard(cardId, ids) {
    if (!Array.isArray(ids)) throw fail(400, 'labels must be an array of label ids');
    const unique = [...new Set(ids.map(String))];
    const unknown = unique.filter((x) => !this.get(x));
    if (unknown.length) throw fail(400, `unknown label: ${unknown[0]}`);
    if (unique.length) this.data.cardLabels[cardId] = unique;
    else delete this.data.cardLabels[cardId];
    this.board.save();
    return this.forCard(cardId);
  }

  /** A card got a new id (a draft that was started): its labels go along. */
  move(fromId, toId) {
    const ids = this.data.cardLabels[fromId];
    if (!ids) return;
    delete this.data.cardLabels[fromId];
    this.data.cardLabels[toId] = ids;
    this.board.save();
  }

  /** A card that is gone for good (a draft that was discarded). */
  forget(cardId) {
    if (!this.data.cardLabels[cardId]) return;
    delete this.data.cardLabels[cardId];
    this.board.save();
  }
}

/**
 * HTTP routes, mounted by server.mjs after authentication:
 *   GET    /api/labels                      → { labels }
 *   POST   /api/labels           {name, color?}  → { label, labels }
 *   PATCH  /api/labels/<id>      {name?, color?} → { label, labels }
 *   DELETE /api/labels/<id>                 → { ok, labels, cards: [touched card ids] }
 *   PUT    /api/sessions/<id>/labels {labels: [ids]} → { labels: [ids], session }
 * Changes go out live: `labels` (the full list) and `session` (each card whose labels changed).
 * @returns {(req, res, path: string) => Promise<boolean>} true when the request was handled
 */
export function labelRoutes(labels, { readJson, send, broadcast, cardById }) {
  const changedList = () => broadcast('labels', labels.list());
  const pushCards = (ids) => { for (const id of ids) { const card = cardById(id); if (card) broadcast('session', card); } };
  return async function handle(req, res, p) {
    let m;
    try {
      if (p === '/api/labels') {
        if (req.method === 'GET') { send(res, 200, { labels: labels.list() }); return true; }
        if (req.method === 'POST') {
          const label = labels.create(await readJson(req));
          changedList();
          send(res, 200, { label, labels: labels.list() });
          return true;
        }
        return false;
      }
      if ((m = p.match(/^\/api\/labels\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'PATCH') {
          const label = labels.update(id, await readJson(req));
          changedList();
          send(res, 200, { label, labels: labels.list() });
          return true;
        }
        if (req.method === 'DELETE') {
          const cards = labels.remove(id);
          changedList();
          pushCards(cards);
          send(res, 200, { ok: true, labels: labels.list(), cards });
          return true;
        }
        return false;
      }
      if ((m = p.match(/^\/api\/sessions\/([^/]+)\/labels$/)) && req.method === 'PUT') {
        const id = decodeURIComponent(m[1]);
        if (!cardById(id)) { send(res, 404, { error: 'not found' }); return true; }
        const body = await readJson(req);
        const ids = labels.setCard(id, body.labels);
        const session = cardById(id);
        if (session) broadcast('session', session);
        send(res, 200, { labels: ids, session });
        return true;
      }
      return false;
    } catch (err) {
      if (!err.status) throw err;
      send(res, err.status, { error: err.message });
      return true;
    }
  };
}
