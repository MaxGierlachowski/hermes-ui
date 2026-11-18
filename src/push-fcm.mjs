// Native push for the Android app through Firebase Cloud Messaging (HTTP v1 API), next to Web Push.
// Off unless HERMES_UI_FCM_SERVICE_ACCOUNT points to a Firebase service-account JSON (from the
// Firebase project the app was built with: its google-services.json and this key belong together).
// No dependency: the OAuth2 token comes from a self-signed JWT (RS256, node:crypto).

import fs from 'node:fs';
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export class FcmSender {
  /** @param {{ client_email: string, private_key: string, project_id: string, token_uri?: string }} account */
  constructor(account, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
    if (!account?.client_email || !account?.private_key || !account?.project_id) throw new Error('FCM service account needs client_email, private_key and project_id');
    this.account = account;
    this.fetch = fetchImpl;
    this.log = log;
    this.token = null; // { value, exp }
  }

  static fromFile(file, opts) {
    return new FcmSender(JSON.parse(fs.readFileSync(file, 'utf8')), opts);
  }

  /** The signed assertion for Google's token endpoint (exported for tests). */
  assertion(now = Math.floor(Date.now() / 1000)) {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: this.account.client_email,
      scope: SCOPE,
      aud: this.account.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.account.private_key);
    return `${header}.${claims}.${b64url(sig)}`;
  }

  async accessToken() {
    if (this.token && this.token.exp - 60 > Date.now() / 1000) return this.token.value;
    const res = await this.fetch(this.account.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: this.assertion() }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`FCM auth failed: ${res.status} ${body.error || ''}`.trim());
    this.token = { value: body.access_token, exp: Date.now() / 1000 + (body.expires_in || 3600) };
    return this.token.value;
  }

  /**
   * Sends one notification. Payload as for Web Push: { title, body, tag, url, badge }. Resolves to
   * 'ok' | 'gone' (token no longer valid: remove it) | 'failed'.
   */
  async send(token, payload, { urgent = false, ttl = 3600 } = {}) {
    const data = Object.fromEntries(Object.entries({ url: payload.url, tag: payload.tag, badge: payload.badge }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    const message = {
      token,
      data,
      notification: { title: payload.title || 'Hermes UI', body: payload.body || '' },
      android: {
        priority: urgent ? 'HIGH' : 'NORMAL',
        ttl: `${ttl}s`,
        // channel_id: the app's notification channel (mobile/src/lib/notify.ts).
        notification: { channel_id: 'hermes', tag: payload.tag || undefined, ...(typeof payload.badge === 'number' ? { notification_count: payload.badge } : {}) },
      },
    };
    try {
      const res = await this.fetch(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return 'ok';
      const body = await res.json().catch(() => ({}));
      const code = body.error?.details?.find((d) => d.errorCode)?.errorCode || body.error?.status;
      if (res.status === 404 || code === 'UNREGISTERED') return 'gone';
      this.log(`push: fcm send failed (${res.status} ${code || ''})`);
      return 'failed';
    } catch (err) {
      this.log(`push: fcm send failed (${err.message})`);
      return 'failed';
    }
  }
}
