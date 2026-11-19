// Paired devices for remote access: each gets a random secret, stored only as a SHA-256 hash in
// data/devices.json, and sent back as an HttpOnly cookie. Pairing codes are single-use and live 10 minutes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_AGE_S = 90 * 86400;
const PAIR_TTL_MS = 10 * 60 * 1000;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class Devices {
  constructor(dir) {
    this.file = path.join(dir, 'devices.json');
    fs.mkdirSync(dir, { recursive: true });
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.items = []; }
    this.codes = new Map(); // code hash -> expiresAt
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2), { mode: 0o600 });
  }

  // irohId: the device's verified iroh endpoint id (X-Iroh-Remote-Id); such devices need no cookie.
  issue({ name, via, remote, irohId = null }) {
    const id = crypto.randomBytes(6).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    if (irohId) this.items = this.items.filter((x) => x.irohId !== irohId);
    this.items.push({ id, name: String(name).slice(0, 60), via, remote: !!remote, irohId, hash: hash(secret), createdAt: now, lastSeen: now, expiresAt: now + MAX_AGE_S * 1000 });
    this.save();
    return { id, cookie: `${id}.${secret}`, maxAgeS: MAX_AGE_S };
  }

  verify(cookie) {
    const [id, secret] = String(cookie || '').split('.');
    if (!id || !secret) return null;
    const d = this.items.find((x) => x.id === id);
    if (!d || d.expiresAt < Date.now()) return null;
    const a = Buffer.from(d.hash, 'hex');
    const b = Buffer.from(hash(secret), 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Date.now() - d.lastSeen > 60000) { d.lastSeen = Date.now(); this.save(); }
    return d;
  }

  verifyIroh(irohId) {
    if (!/^[0-9a-f]{64}$/.test(String(irohId || ''))) return null;
    const d = this.items.find((x) => x.irohId === irohId && x.expiresAt > Date.now());
    if (d && Date.now() - d.lastSeen > 60000) { d.lastSeen = Date.now(); this.save(); }
    return d || null;
  }

  irohIds() {
    return this.items.filter((x) => x.irohId && x.expiresAt > Date.now()).map((x) => x.irohId);
  }

  pairingOpen() {
    const now = Date.now();
    for (const [k, exp] of this.codes) if (exp < now) this.codes.delete(k);
    return this.codes.size > 0;
  }

  revoke(id) {
    this.items = this.items.filter((x) => x.id !== id);
    this.save();
  }

  list() {
    return this.items.map(({ hash: _h, ...rest }) => rest);
  }

  pairingCode() {
    const code = crypto.randomBytes(16).toString('base64url');
    const expiresAt = Date.now() + PAIR_TTL_MS;
    this.codes.set(hash(code), expiresAt);
    return { code, expiresAt };
  }

  redeem(code, { name, remote, irohId = null }) {
    const h = hash(String(code || ''));
    const exp = this.codes.get(h);
    if (!exp || exp < Date.now()) return null;
    this.codes.delete(h);
    return this.issue({ name, via: irohId ? 'iroh' : 'pairing', remote, irohId });
  }
}
