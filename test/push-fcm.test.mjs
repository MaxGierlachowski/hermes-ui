import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FcmSender } from '../src/push-fcm.mjs';
import { Push } from '../src/push.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'sender@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'demo-project' };

function fakeFetch(sendStatus = 200, sendBody = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify(sendBody), { status: sendStatus });
  };
  return { fn, calls };
}

test('the OAuth assertion is an RS256 JWT for the messaging scope, signed with the account key', () => {
  const jwt = new FcmSender(account).assertion(1_700_000_000);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'RS256');
  assert.equal(claims.iss, account.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('send: one token request, then an HTTP v1 message on the app channel; the token is reused', async () => {
  const { fn, calls } = fakeFetch();
  const fcm = new FcmSender(account, { fetchImpl: fn });
  assert.equal(await fcm.send('tok-123', { title: 'Freigabe nötig', body: 'rm -rf build', tag: 's1', url: '#/inbox', badge: 2 }, { urgent: true }), 'ok');
  assert.equal(await fcm.send('tok-123', { title: 'x' }), 'ok');
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);
  const sendCall = calls.find((c) => c.url.includes('messages:send'));
  assert.equal(sendCall.url, 'https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
  assert.equal(sendCall.init.headers.authorization, 'Bearer at-1');
  const { message } = JSON.parse(sendCall.init.body);
  assert.equal(message.token, 'tok-123');
  assert.equal(message.android.priority, 'HIGH');
  assert.equal(message.android.notification.channel_id, 'hermes');
  assert.deepEqual(message.data, { url: '#/inbox', tag: 's1', badge: '2' });
});

test('an unregistered token reports gone', async () => {
  const { fn } = fakeFetch(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
  assert.equal(await new FcmSender(account, { fetchImpl: fn }).send('old', { title: 't' }), 'gone');
});

test('Push: native tokens need FCM config; with it they get notifications and are dropped when gone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-push-'));
  const keyFile = path.join(dir, 'sa.json');
  fs.writeFileSync(keyFile, JSON.stringify(account));
  const quiet = () => {};

  const without = new Push(dir, { log: quiet });
  assert.throws(() => without.subscribeNative('dev-1', 'Android', { token: 'x'.repeat(40) }), { status: 501 });

  const push = new Push(dir, { fcmServiceAccount: keyFile, log: quiet });
  const { fn, calls } = fakeFetch();
  push.fcm.fetch = fn;
  push.subscribeNative('dev-1', 'Android · Hermes UI app', { token: 'a'.repeat(40) });
  push.subscribeNative('dev-1', 'Android · Hermes UI app', { token: 'b'.repeat(40) }); // reinstall: replaces the old token
  assert.equal(push.subs.filter((s) => s.kind === 'fcm').length, 1);
  assert.equal(await push.notify({ category: 'done', source: 'hermes', title: 'Fertig', body: 'ok', tag: 't', url: '#/board' }), 1);
  assert.ok(calls.some((c) => c.url.includes('messages:send') && c.init.body.includes('b'.repeat(40))));

  push.fcm.fetch = fakeFetch(404, { error: { details: [{ errorCode: 'UNREGISTERED' }] } }).fn;
  assert.equal(await push.notify({ category: 'done', source: 'hermes', title: 'Fertig', body: 'ok' }), 0);
  assert.equal(push.subs.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
