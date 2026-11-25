// Native notifications for the installed PWA (and desktop browsers) with standard Web Push.
// The backend only sends outgoing HTTPS requests to the push service the browser chose (Apple, Google,
// Mozilla); nothing has to reach this machine from outside. VAPID keys are generated on first start
// and kept in <data-dir>/vapid.json, subscriptions (one per browser, tied to its paired device) in
// <data-dir>/push.json. Both are private to this machine and never part of the repo.

import fs from 'node:fs';
import path from 'node:path';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { FcmSender } from './push-fcm.mjs';

export const DEFAULT_SETTINGS = {
  approval: true, // approvals, clarify questions, Paseo permissions
  done: true, // a Hermes chat finished (and its Paseo agents are done), a Paseo agent finished
  error: true, // errors, usage limits
  paseo: true, // include Paseo agent events at all
  automations: true, // a cron or webhook run reported something
  automationErrors: true, // a cron or webhook run failed or was blocked; notify with level error
  notify: true, // messages sent with POST /api/notify (hermes-ui notify)
  skipWhenVisible: true, // no push while this device has the app open and visible
  quiet: { enabled: false, from: '22:00', to: '07:00' }, // in the device's time zone
  tz: null,
};

const mins = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

function inQuietHours(settings, now = new Date()) {
  const q = settings.quiet;
  if (!q?.enabled) return false;
  let hm;
  try {
    hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: settings.tz || undefined }).format(now);
  } catch { hm = `${now.getHours()}:${now.getMinutes()}`; }
  const cur = mins(hm);
  const from = mins(q.from);
  const to = mins(q.to);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}

function cleanSettings(s = {}, prev = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...prev };
  for (const k of ['approval', 'done', 'error', 'paseo', 'automations', 'automationErrors', 'notify', 'skipWhenVisible']) if (typeof s[k] === 'boolean') out[k] = s[k];
  if (s.quiet && typeof s.quiet === 'object') {
    const hm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v)) ? String(v) : d);
    out.quiet = { enabled: !!s.quiet.enabled, from: hm(s.quiet.from, out.quiet.from), to: hm(s.quiet.to, out.quiet.to) };
  }
  if (typeof s.tz === 'string' && s.tz.length < 64) out.tz = s.tz;
  return out;
}

const isApple = (endpoint) => /(^|\.)push\.apple\.com$/.test(new URL(endpoint).hostname);
const isNative = (sub) => sub.kind === 'fcm';
const hostOf = (sub) => (isNative(sub) ? 'fcm' : new URL(sub.endpoint).host);

export class Push {
  constructor(dir, { subject, fcmServiceAccount = '', log = console.log } = {}) {
    this.dir = dir;
    this.log = log;
    // Native app (Android): FCM, only with a service account of the app's Firebase project.
    this.fcm = null;
    if (fcmServiceAccount) {
      try { this.fcm = FcmSender.fromFile(fcmServiceAccount, { log }); log(`push: FCM enabled (project ${this.fcm.account.project_id})`); } catch (err) { log(`push: FCM disabled (${err.message})`); }
    }
    this.file = path.join(dir, 'push.json');
    fs.mkdirSync(dir, { recursive: true });
    const keyFile = path.join(dir, 'vapid.json');
    try { this.vapid = JSON.parse(fs.readFileSync(keyFile, 'utf8')); } catch { this.vapid = null; }
    if (!this.vapid?.publicKey) {
      this.vapid = generateVAPIDKeys();
      fs.writeFileSync(keyFile, JSON.stringify(this.vapid, null, 2), { mode: 0o600 });
      log(`push: generated VAPID keys in ${keyFile}`);
    }
    // Apple rejects VAPID tokens whose subject is not a mailto: or https: URL.
    this.subject = /^(mailto:|https:\/\/)/.test(subject || '') ? subject : 'mailto:hermes-ui@users.noreply.github.com';
    try { this.subs = JSON.parse(fs.readFileSync(this.file, 'utf8')).subscriptions || []; } catch { this.subs = []; }
    this.presence = new Map(); // deviceKey -> { visible, at }
  }

  get publicKey() { return this.vapid.publicKey; }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ subscriptions: this.subs }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Subscriptions of one device (without the keys). */
  forDevice(deviceKey) {
    return this.subs.filter((s) => s.deviceKey === deviceKey).map(({ endpoint, settings, createdAt, deviceName }) => ({ endpoint, settings, createdAt, deviceName }));
  }

  subscribe(deviceKey, deviceName, subscription, settings) {
    const { endpoint, keys } = subscription || {};
    if (!/^https:\/\//.test(endpoint || '') || !keys?.p256dh || !keys?.auth) throw Object.assign(new Error('invalid push subscription'), { status: 400 });
    const prev = this.subs.find((s) => s.endpoint === endpoint);
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    const entry = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, deviceKey, deviceName: String(deviceName || '').slice(0, 60), createdAt: prev?.createdAt || Date.now(), settings: cleanSettings(settings, prev?.settings) };
    this.subs.push(entry);
    this.save();
    return { endpoint, settings: entry.settings };
  }

  updateSettings(deviceKey, endpoint, settings) {
    const s = this.subs.find((x) => x.endpoint === endpoint && x.deviceKey === deviceKey);
    if (!s) return null;
    s.settings = cleanSettings(settings, s.settings);
    this.save();
    return s.settings;
  }

  unsubscribe(deviceKey, endpoint) {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => !(s.endpoint === endpoint && s.deviceKey === deviceKey));
    if (this.subs.length !== before) this.save();
  }

  /**
   * Native app token (FCM). Stored like a Web Push subscription with kind 'fcm'; the endpoint key
   * `fcm:<token>` keeps one entry per app install. Throws 501 when the backend has no FCM config.
   */
  subscribeNative(deviceKey, deviceName, { token, kind = 'fcm', platform = 'android' } = {}, settings) {
    if (kind !== 'fcm') throw Object.assign(new Error(`native push kind ${kind} is not supported`), { status: 400 });
    if (!this.fcm) throw Object.assign(new Error('native push not configured (HERMES_UI_FCM_SERVICE_ACCOUNT)'), { status: 501 });
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw Object.assign(new Error('invalid push token'), { status: 400 });
    const endpoint = `fcm:${token}`;
    const prev = this.subs.find((s) => s.endpoint === endpoint);
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint && !(isNative(s) && s.deviceKey === deviceKey));
    const entry = { kind: 'fcm', endpoint, token, platform: String(platform).slice(0, 16), deviceKey, deviceName: String(deviceName || '').slice(0, 60), createdAt: prev?.createdAt || Date.now(), settings: cleanSettings(settings, prev?.settings) };
    this.subs.push(entry);
    this.save();
    return { endpoint, settings: entry.settings };
  }

  /** Called when a device is unpaired or signs out: its subscriptions go with it. */
  removeDevice(deviceKey) {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.deviceKey !== deviceKey);
    this.presence.delete(deviceKey);
    if (this.subs.length !== before) { this.save(); this.log(`push: removed ${before - this.subs.length} subscription(s) of device ${deviceKey}`); }
  }

  /** The UI reports whether it is visible; pushes to that device are skipped meanwhile (if it wants that). */
  setPresence(deviceKey, visible) { this.presence.set(deviceKey, { visible: !!visible, at: Date.now() }); }
  isVisible(deviceKey) {
    const p = this.presence.get(deviceKey);
    return !!p && p.visible && Date.now() - p.at < 70000;
  }

  /**
   * ev: { category: 'approval'|'done'|'error'|'automations'|'automationErrors'|'notify', source: 'hermes'|'paseo'|'cron'|'webhook'|'notify', title, body, url, tag, badge,
   *       actions?: [{ action, title }] (only offered where notification actions work, i.e. not on Apple) }
   */
  async notify(ev, { only = null } = {}) {
    const targets = this.subs.filter((s) => (only ? s.endpoint === only
      : s.settings[ev.category] !== false
        && (ev.source !== 'paseo' || s.settings.paseo !== false)
        && !(s.settings.skipWhenVisible && this.isVisible(s.deviceKey))
        && !inQuietHours(s.settings)));
    const results = await Promise.all(targets.map((s) => this.sendOne(s, ev)));
    return results.filter(Boolean).length;
  }

  async sendOne(sub, ev) {
    if (isNative(sub)) {
      if (!this.fcm) return false;
      const r = await this.fcm.send(sub.token, { title: ev.title, body: ev.body, tag: ev.tag, url: ev.url, badge: ev.badge ?? null }, { urgent: ev.category === 'approval', ttl: ev.ttl ?? 3600 });
      if (r === 'gone') {
        this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
        this.save();
        this.log('push: fcm token gone, removed');
      }
      return r === 'ok';
    }
    const payload = {
      title: ev.title,
      body: ev.body,
      tag: ev.tag,
      url: ev.url,
      badge: ev.badge ?? null,
      ...(ev.actions?.length && !isApple(sub.endpoint) ? { actions: ev.actions, confirm: ev.confirm || null } : {}),
    };
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
        TTL: ev.ttl ?? 3600,
        urgency: ev.category === 'approval' ? 'high' : 'normal',
        vapidDetails: { subject: this.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        timeout: 10000,
      });
      return true;
    } catch (err) {
      // 404/410: the browser dropped the subscription (uninstalled, permission revoked, expired).
      if (err.statusCode === 404 || err.statusCode === 410) {
        this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
        this.save();
        this.log(`push: subscription gone (${err.statusCode}), removed ${hostOf(sub)}`);
      } else this.log(`push: send failed (${err.statusCode || err.message}) ${hostOf(sub)}`);
      return false;
    }
  }
}
