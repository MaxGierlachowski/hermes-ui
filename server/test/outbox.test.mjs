import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Outbox } from '../src/outbox.mjs';

const fakeBoard = () => ({ data: {}, saves: 0, save() { this.saves++; } });
const QUEUED = JSON.stringify({ _queued_prompt: true });
const waiting = (ob, sid, text, extra = {}) => {
  const e = ob.add(sid, { text, afterMsgId: 10, afterSeq: 100, ...extra });
  return ob.update(e.id, { status: 'waiting', ...extra });
};

test('an entry is removed once Hermes wrote the message as a user row', () => {
  const ob = new Outbox(fakeBoard());
  waiting(ob, 's', 'Bitte auch X');
  assert.equal(ob.reconcile('s', [{ id: 9, content: 'Bitte auch X' }], [], true), false, 'older rows do not count');
  assert.equal(ob.reconcile('s', [{ id: 12, content: 'Bitte auch X' }], [], true), true);
  assert.equal(ob.forSession('s').length, 0);
});

test("forwarded to Hermes' FIFO: queued -> started -> taken over, never lost while queued", () => {
  const ob = new Outbox(fakeBoard());
  const e = waiting(ob, 's', 'Danach Y', { admissionId: 'a1' });
  ob.reconcile('s', [], [{ seq: 101, admission_id: 'a1', status: 'queued', text: 'Danach Y' }], false, 0);
  ob.reconcile('s', [], [{ seq: 101, admission_id: 'a1', status: 'queued', text: 'Danach Y' }], false, 60000);
  assert.equal(ob.get(e.id).status, 'queued');
  ob.reconcile('s', [], [{ seq: 101, admission_id: 'a1', status: 'started', text: 'Danach Y' }], true);
  assert.equal(ob.get(e.id).status, 'started');
  ob.reconcile('s', [{ id: 20, content: 'Danach Y' }], [{ seq: 101, admission_id: 'a1', status: 'terminal', outcome: 'completed' }], true);
  assert.equal(ob.get(e.id), null);
});

test('an admission found by text (no id in the answer) and one that ended without a turn', () => {
  const ob = new Outbox(fakeBoard());
  const e = waiting(ob, 's', 'Z');
  ob.reconcile('s', [], [{ seq: 99, admission_id: 'old', status: 'queued', text: 'Z' }, { seq: 102, admission_id: 'a2', status: 'queued', text: 'Z' }], true);
  assert.equal(ob.get(e.id).admissionId, 'a2', 'only admissions after the send count');
  ob.reconcile('s', [], [{ seq: 102, admission_id: 'a2', status: 'terminal', outcome: 'cancelled', text: 'Z' }], false);
  assert.equal(ob.get(e.id).status, 'lost');
  assert.equal(ob.get(e.id).error, 'cancelled');
});

test('a _queued_prompt row keeps the entry as "queued" until Hermes re-places it', () => {
  const ob = new Outbox(fakeBoard());
  const e = waiting(ob, 's', 'Danach bitte Y');
  ob.reconcile('s', [{ id: 11, content: 'Danach bitte Y', display_metadata: QUEUED }], [], true);
  assert.equal(ob.get(e.id).status, 'queued');
  assert.equal(ob.get(e.id).rowId, 11);
  ob.reconcile('s', [{ id: 11, content: 'Danach bitte Y', display_metadata: QUEUED, active: 0 }, { id: 15, content: 'Danach bitte Y' }], [], false);
  assert.equal(ob.get(e.id), null);
});

test('merged queued prompts take over every entry they contain', () => {
  const ob = new Outbox(fakeBoard());
  waiting(ob, 's', 'A');
  waiting(ob, 's', 'B');
  ob.reconcile('s', [{ id: 15, content: 'A\n\nB' }], [], false);
  assert.equal(ob.forSession('s').length, 0);
});

test('a steer row (wrapped by Hermes) matches the plain text', () => {
  const ob = new Outbox(fakeBoard());
  waiting(ob, 's', 'Stopp, nimm Z');
  ob.reconcile('s', [{ id: 13, display_kind: 'steer', content: '[OUT-OF-BAND USER MESSAGE — x]\nStopp, nimm Z\n[/OUT-OF-BAND USER MESSAGE]' }], [], true);
  assert.equal(ob.forSession('s').length, 0);
});

test('turn over without the message: lost after the grace period, never while running or sending', () => {
  const ob = new Outbox(fakeBoard());
  const e = ob.add('s', { text: 'weg?', afterMsgId: 1 });
  ob.reconcile('s', [], [], false, 0);
  assert.equal(ob.get(e.id).status, 'sending', 'submit still in flight');
  ob.update(e.id, { status: 'waiting' });
  ob.reconcile('s', [], [], true, 0);
  ob.reconcile('s', [], [], false, 1000);
  ob.reconcile('s', [], [], false, 15000);
  assert.equal(ob.get(e.id).status, 'waiting');
  ob.reconcile('s', [], [], false, 22000);
  assert.equal(ob.get(e.id).status, 'lost');
});

test('failed entries stay until retried or dismissed', () => {
  const ob = new Outbox(fakeBoard());
  const e = ob.add('s', { text: 'x', afterMsgId: 1 });
  ob.update(e.id, { status: 'failed', error: 'SESSION_OWNER_BUSY' });
  ob.reconcile('s', [{ id: 2, content: 'x' }], [], false, 99999);
  assert.equal(ob.get(e.id).status, 'failed');
  ob.remove(e.id);
  assert.equal(ob.list.length, 0);
});
