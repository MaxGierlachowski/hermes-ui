import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentColumn, agentsBusy, sortAgents } from '../src/agent-column.mjs';

const t = (k, v = {}) => `${k}:${v.n ?? ''}${v.titles ? `:${v.titles}` : ''}${v.title ? `:${v.title}` : ''}`;
const base = { autoColumn: 'waiting', column: 'waiting', overridden: false, pending: 0, system: false, t };
const hermes = (state, title = 'Audit') => ({ id: `hermes:default:${title}`, provider: 'hermes', state, rel: 'created', archived: false, title });
const paseo = (state, title = 'Fix') => ({ id: title, state, rel: 'created', archived: false, title });

test('a running Hermes subagent keeps the chat in Doing after Hermes\' turn ended', () => {
  assert.deepEqual(agentColumn({ ...base, agents: [hermes('running'), hermes('finished', 'Old')] }), { column: 'doing', note: 'agentsRunningList:1:Audit' });
});

test('finished, failed or unknown children leave the chat in Waiting', () => {
  for (const state of ['finished', 'error', 'unknown']) assert.deepEqual(agentColumn({ ...base, agents: [hermes(state)] }), { column: 'waiting', note: '' });
});

test('Paseo-only wording is unchanged; mixed lists say "agents"', () => {
  assert.equal(agentColumn({ ...base, agents: [paseo('running')] }).note, 'paseoRunningList:1:Fix');
  assert.equal(agentColumn({ ...base, agents: [paseo('running'), hermes('running')] }).note, 'agentsRunningList:2:Fix, Audit');
});

test('Hermes still working: stays Doing, note counts the children', () => {
  assert.deepEqual(agentColumn({ ...base, autoColumn: 'doing', column: 'doing', agents: [hermes('running')] }), { column: 'doing', note: 'agentsRunning:1' });
});

test('a manual column wins; open prompts, system chats and Done are left alone', () => {
  assert.equal(agentColumn({ ...base, column: 'done', overridden: true, agents: [hermes('running')] }).column, 'done');
  assert.deepEqual(agentColumn({ ...base, pending: 1, agents: [hermes('running')] }), { column: 'waiting', note: '' });
  assert.deepEqual(agentColumn({ ...base, system: true, agents: [hermes('running')] }), { column: 'waiting', note: '' });
  assert.deepEqual(agentColumn({ ...base, autoColumn: 'done', column: 'done', agents: [hermes('running')] }), { column: 'done', note: '' });
});

test('watched or archived agents do not keep a chat busy', () => {
  assert.equal(agentColumn({ ...base, agents: [{ ...paseo('running'), rel: 'watches' }, { ...paseo('running'), archived: true }] }).column, 'waiting');
  assert.equal(agentsBusy([{ ...paseo('running'), rel: 'watches' }]), false);
  assert.equal(agentsBusy([hermes('running')]), true);
  assert.equal(agentsBusy([paseo('needs-attention')]), true);
});

test('order: blocked, running, failed, finished', () => {
  assert.deepEqual(sortAgents([hermes('finished', 'a'), hermes('error', 'b'), paseo('needs-attention', 'c'), hermes('running', 'd')]).map((a) => a.title), ['c', 'd', 'b', 'a']);
});
