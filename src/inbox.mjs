// The inbox history: what happened across all chats (approvals asked and answered, finished turns,
// errors, Paseo agents that finished or failed). Open requests themselves are not stored here; they
// are always derived live from Hermes and Paseo (see openItems() in server.mjs).
// Lives in <data-dir>/inbox.json, bounded by age and count.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class Inbox extends EventEmitter {
  constructor(dir, { maxItems = 1000, maxDays = 30 } = {}) {
    super();
    this.file = path.join(dir, 'inbox.json');
    this.maxItems = maxItems;
    this.maxDays = maxDays;
    fs.mkdirSync(dir, { recursive: true });
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).items || []; } catch { this.items = []; }
    this.byId = new Map(this.items.map((x) => [x.id, x]));
    this.prune();
  }

  prune() {
    const cut = Date.now() / 1000 - this.maxDays * 86400;
    this.items = this.items.filter((x) => x.at >= cut).sort((a, b) => b.at - a.at).slice(0, this.maxItems);
    this.byId = new Map(this.items.map((x) => [x.id, x]));
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ items: this.items }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    }, 300);
  }

  has(id) { return this.byId.has(id); }
  get(id) { return this.byId.get(id) || null; }

  /**
   * Adds an entry once (the id makes it idempotent). Returns the entry if it is new, otherwise null.
   * kind: approval | clarify | permission | done | error | paseo-done | paseo-error | paseo-limit
   */
  add(entry) {
    if (this.byId.has(entry.id)) return null;
    const item = { read: false, at: Date.now() / 1000, ...entry };
    this.items.unshift(item);
    this.byId.set(item.id, item);
    if (this.items.length > this.maxItems * 1.1) this.prune();
    this.save();
    this.emit('item', item);
    return item;
  }

  /** Records how a request ended: answered here (with the answer), elsewhere, or expired. */
  resolve(id, resolution) {
    const item = this.byId.get(id);
    if (!item || item.resolution) return null;
    item.resolution = { at: Date.now() / 1000, ...resolution };
    this.save();
    this.emit('item', item);
    return item;
  }

  /** Fills in details that arrived later (e.g. the command of a Paseo permission). */
  update(id, patch) {
    const item = this.byId.get(id);
    if (!item) return null;
    Object.assign(item, patch);
    this.save();
    this.emit('item', item);
    return item;
  }

  markRead(ids) {
    const changed = [];
    for (const item of this.items) {
      if (item.read || (ids !== 'all' && !ids.includes(item.id))) continue;
      item.read = true;
      changed.push(item.id);
    }
    if (changed.length) this.save();
    return changed;
  }

  unread() { return this.items.reduce((n, x) => n + (x.read ? 0 : 1), 0); }

  list({ limit = 500, before = Infinity } = {}) {
    return this.items.filter((x) => x.at < before).slice(0, limit);
  }
}
