// The "Summary" pill (shared/summary.ts): when it shows, and that one click sends exactly one message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_PROMPT, SUMMARY_SENT_MS, sendSummary, summaryPillState } from '../../shared/summary.ts';

test('pill: hidden for an empty chat and while a turn runs, ready otherwise', () => {
  assert.equal(summaryPillState({ messages: 0, running: false, phase: 'idle' }), 'hidden');
  assert.equal(summaryPillState({ messages: 4, running: true, phase: 'idle' }), 'hidden');
  assert.equal(summaryPillState({ messages: 4, running: false, phase: 'idle' }), 'ready');
});

test('pill: feedback states win over hidden (the new turn starts while "sent" shows)', () => {
  assert.equal(summaryPillState({ messages: 4, running: true, phase: 'sending' }), 'sending');
  assert.equal(summaryPillState({ messages: 4, running: true, phase: 'sent' }), 'sent');
});

test('prompt: summary, state and open tasks, in the chat language, no new work; generic', () => {
  assert.match(SUMMARY_PROMPT, /summar/i);
  assert.match(SUMMARY_PROMPT, /open tasks/i);
  assert.match(SUMMARY_PROMPT, /who has to do it/);
  assert.match(SUMMARY_PROMPT, /blocked by/);
  assert.match(SUMMARY_PROMPT, /language this chat/);
  assert.doesNotMatch(SUMMARY_PROMPT, /move2pay|benmo/i);
});

test('sendSummary: sends the prompt once, sending → sent → idle', async () => {
  const phase = { current: 'idle' };
  const seen = [];
  const sent = [];
  let timer;
  const ok = await sendSummary(phase, (p) => seen.push(p), async (text) => { sent.push(text); return true }, (fn, ms) => { timer = { fn, ms } });
  assert.equal(ok, true);
  assert.deepEqual(sent, [SUMMARY_PROMPT]);
  assert.deepEqual(seen, ['sending', 'sent']);
  assert.equal(timer.ms, SUMMARY_SENT_MS);
  timer.fn();
  assert.equal(phase.current, 'idle');
});

test('sendSummary: a double click sends one message', async () => {
  const phase = { current: 'idle' };
  let calls = 0;
  let release;
  const send = () => { calls++; return new Promise((r) => { release = r }) };
  const first = sendSummary(phase, () => {}, send, () => {});
  const second = await sendSummary(phase, () => {}, send, () => {});
  assert.equal(second, false);
  release(true);
  assert.equal(await first, true);
  assert.equal(await sendSummary(phase, () => {}, send, () => {}), false, 'still in "sent": refused');
  assert.equal(calls, 1);
});

test('sendSummary: not delivered (false or throw) → back to idle, can be clicked again', async () => {
  for (const send of [async () => false, async () => { throw new Error('offline') }]) {
    const phase = { current: 'idle' };
    const seen = [];
    assert.equal(await sendSummary(phase, (p) => seen.push(p), send, () => {}), false);
    assert.deepEqual(seen, ['sending', 'idle']);
    assert.equal(phase.current, 'idle');
  }
});
