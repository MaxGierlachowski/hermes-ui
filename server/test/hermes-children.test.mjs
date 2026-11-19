import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childCalls, childTimeline, childView, hermesRuns, matchSubagents, matchTerminal, parseChildId, promptFileOf, shellTokens, subagentState, terminalState } from '../src/hermes-children.mjs';

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const assistant = (id, ts, ...calls) => ({ id, role: 'assistant', content: '', tool_calls: JSON.stringify(calls), timestamp: ts });
const tool = (id, ts, name, callId, content) => ({ id, role: 'tool', tool_name: name, tool_call_id: callId, content: typeof content === 'string' ? content : JSON.stringify(content), timestamp: ts });

// ---------- shell commands ----------

test('shell tokens: quotes, $(…), separators, 2> redirection', () => {
  assert.deepEqual(shellTokens(`cd ~ && hermes chat -q "it's \\"ok\\"" > out.log 2>&1`), ['cd', '~', '&&', 'hermes', 'chat', '-q', `it's "ok"`, '>', 'out.log', '2>', '&1']);
  assert.deepEqual(shellTokens(`hermes chat -q "$(cat /tmp/a b.md)"`), ['hermes', 'chat', '-q', '$(cat /tmp/a b.md)']);
});

test('hermes runs: profile, -q / --query-file / $(cat …), env prefix, several per command', () => {
  assert.deepEqual(hermesRuns(`cd ~ && hermes -p data chat -q 'Antworte nur OK' > x.out 2>&1`), [{ profile: 'data', query: 'Antworte nur OK', queryFile: null, source: null }]);
  assert.deepEqual(hermesRuns(`BU_CDP_URL=http://127.0.0.1:9333 hermes --profile=support chat -Q --oneshot -m m1 --query-file ~/p.md`), [{ profile: 'support', query: null, queryFile: '~/p.md', source: null }]);
  assert.deepEqual(hermesRuns(`hermes chat -q "$(cat ~/x/prompt.md)"`).map((r) => promptFileOf(r.query)), ['~/x/prompt.md']);
  assert.equal(hermesRuns('hermes chat -q a; nohup hermes -p infra chat --query=b &').length, 2);
  assert.equal(hermesRuns('hermes -p default chat -q a')[0].profile, null);
});

test('not a hermes run: other subcommands, interactive chat, the word in an argument', () => {
  assert.deepEqual(hermesRuns('hermes gateway restart'), []);
  assert.deepEqual(hermesRuns('hermes chat'), []);
  assert.deepEqual(hermesRuns('echo hermes chat -q x'), []);
  assert.deepEqual(hermesRuns('grep -rn "hermes chat -q" docs/'), []);
});

// ---------- calls in the parent transcript ----------

test('background delegate_task: one call per task, subagent and delegation ids from the result', () => {
  const rows = [
    assistant(10, 100, call('t1', 'delegate_task', { tasks: [{ goal: 'Audit Gmail' }, { goal: 'Audit GitLab' }] })),
    tool(11, 101, 'delegate_task', 't1', { status: 'dispatched', mode: 'background', delegation_id: 'deleg_1', subagent_ids: ['sa-0-aa', 'sa-1-bb'] }),
  ];
  const calls = childCalls(rows);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => [c.kind, c.msgId, c.index, c.goal, c.subagentId, c.delegationId, c.background]), [
    ['subagent', 10, 0, 'Audit Gmail', 'sa-0-aa', 'deleg_1', true],
    ['subagent', 10, 1, 'Audit GitLab', 'sa-1-bb', 'deleg_1', true],
  ]);
});

test('delegate_task: synchronous results, compacted results, steer calls, refused calls', () => {
  const rows = [
    assistant(1, 10, call('a', 'delegate_task', { goal: 'Sync task' })),
    tool(2, 20, 'delegate_task', 'a', { results: [{ task_index: 0, status: 'completed', summary: '…' }] }),
    assistant(3, 30, call('b', 'delegate_task', { tasks: [{ goal: 'Compacted' }] })),
    tool(4, 31, 'delegate_task', 'b', "[delegate_task] '' (1,438 chars result)"),
    assistant(5, 40, call('c', 'delegate_task', { action: 'steer', subagent_id: 'sa-0-aa', message: 'faster' })),
    assistant(6, 50, call('d', 'delegate_task', { goal: 'Refused' })),
    tool(7, 51, 'delegate_task', 'd', { error: 'max concurrent subagents reached' }),
  ];
  const calls = childCalls(rows);
  assert.deepEqual(calls.map((c) => [c.goal, c.taskStatus ?? null, c.failed ?? null]), [
    ['Sync task', 'completed', null],
    ['Compacted', null, null],
    ['Refused', null, 'max concurrent subagents reached'],
  ]);
});

test('terminal runs: background proc id + pid, completion notice with exit code, foreground result', () => {
  const rows = [
    assistant(1, 100, call('t1', 'terminal', { command: "hermes -p support chat -q 'Antworte nur OK' > o.log 2>&1", background: true, notify: true })),
    tool(2, 100.5, 'terminal', 't1', { output: 'Background process started', session_id: 'proc_abc123', pid: 4242, exit_code: 0, error: null }),
    assistant(3, 200, call('t2', 'terminal', { command: 'hermes chat -q "zweiter"' })),
    tool(4, 260, 'terminal', 't2', { output: 'OK', exit_code: 3, error: null }),
    { id: 5, role: 'user', display_kind: 'process_complete', content: '[IMPORTANT: Background process proc_abc123 completed normally (exit code 0).\nCommand: hermes …', timestamp: 300 },
    assistant(6, 400, call('t3', 'terminal', { command: 'ls -la' })),
  ];
  const calls = childCalls(rows);
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[0].profile, calls[0].query, calls[0].procId, calls[0].pid, calls[0].exitCode, calls[0].doneTs], ['support', 'Antworte nur OK', 'proc_abc123', 4242, 0, 300]);
  assert.deepEqual([calls[1].profile, calls[1].procId, calls[1].exitCode], [null, null, 3]);
});

test('calls through the tool_call wrapper count too', () => {
  const rows = [assistant(1, 10, call('w', 'tool_call', { calls: [{ name: 'terminal', arguments: { command: 'hermes chat -q hi', background: true } }] }))];
  assert.equal(childCalls(rows)[0].kind, 'terminal');
});

// ---------- matching ----------

test('subagents: hard id first, then goal in the first message, then start order; segments grouped', () => {
  const calls = childCalls([
    assistant(1, 100, call('bg', 'delegate_task', { tasks: [{ goal: 'Background job number one' }] })),
    tool(2, 101, 'delegate_task', 'bg', { delegation_id: 'deleg_9', subagent_ids: ['sa-0-x'] }),
    assistant(3, 200, call('sync', 'delegate_task', { tasks: [{ goal: 'Analyse group A of the inbox' }, { goal: 'Analyse group B of the inbox' }, { goal: 'short' }] })),
    tool(4, 300, 'delegate_task', 'sync', { results: [{ task_index: 0, status: 'completed' }, { task_index: 1, status: 'failed' }, { task_index: 2, status: 'completed' }] }),
  ]);
  const sessions = [
    { id: 's-bg', subagent_id: 'sa-0-x', started_at: 101 },
    { id: 's-bg-2', subagent_id: 'sa-0-x', started_at: 150 }, // compression continuation
    { id: 's-b', started_at: 201, first_prompt: 'CONTEXT … Analyse group B of the inbox …' },
    { id: 's-a', started_at: 202, first_prompt: 'Analyse group A of the inbox' },
    { id: 's-c', started_at: 203, first_prompt: 'something else' },
    { id: 's-late', started_at: 999 },
  ];
  const m = matchSubagents(calls, sessions);
  assert.deepEqual(calls.map((c) => [m.get(c)?.map((s) => s.id).join('+'), c.match]), [
    ['s-bg+s-bg-2', 'id'],
    ['s-a', 'goal'],
    ['s-b', 'goal'],
    ['s-c', 'order'],
  ]);
});

test('subagents of older Hermes (no _subagent_id): background call matched in its window by goal', () => {
  const calls = childCalls([
    assistant(1, 100, call('bg', 'delegate_task', { goal: 'Check the Shopify store settings' })),
    tool(2, 101, 'delegate_task', 'bg', { delegation_id: 'd', subagent_ids: ['sa-0-q'] }),
  ]);
  const m = matchSubagents(calls, [{ id: 'old', started_at: 100.5, first_prompt: 'Check the Shopify store settings please' }]);
  assert.equal(m.get(calls[0])?.[0].id, 'old');
  assert.equal(calls[0].match, 'goal');
});

test('terminal: prompt equality wins over time; time only when exactly one oneshot started right after', () => {
  const c = { ts: 1000, query: 'Antworte nur OK', source: null };
  const cands = [
    { id: 'other', source: 'oneshot', started_at: 1001, first_prompt: 'something else' },
    { id: 'mine', source: 'oneshot', started_at: 1003, first_prompt: '  Antworte nur  OK ' },
  ];
  assert.deepEqual(matchTerminal(c, cands), { session: cands[1], match: 'prompt' });
  const two = [cands[0], { ...cands[0], id: 'other-2', started_at: 1002 }];
  assert.equal(matchTerminal(c, two), null); // prompt matches neither, two started right after: no guess
  const file = { ts: 1000, query: '$(cat /tmp/p.md)' };
  assert.deepEqual(matchTerminal(file, [cands[0]]), { session: cands[0], match: 'time' });
  assert.deepEqual(matchTerminal(file, cands, new Set(), 'something else'), { session: cands[0], match: 'prompt' });
  assert.equal(matchTerminal(file, [{ id: 'cron', source: 'cron', started_at: 1001 }]), null);
  assert.equal(matchTerminal(file, [{ id: 'before', source: 'oneshot', started_at: 990 }]), null);
});

// ---------- state ----------

test('subagent state from real data: ended row, delegation record, sync result, stale', () => {
  const now = 10_000;
  const bg = { background: true, ts: 100, resultTs: 101 };
  assert.equal(subagentState({ call: bg, segments: [{ started_at: 100, ended_at: 200, end_reason: 'agent_close' }], now }), 'finished');
  assert.equal(subagentState({ call: bg, segments: [{ started_at: 100, ended_at: 200, end_reason: 'error' }], now }), 'error');
  assert.equal(subagentState({ call: bg, segments: [{ started_at: 9000, last_activity_at: 9990 }], delegation: { state: 'running' }, now }), 'running');
  assert.equal(subagentState({ call: bg, segments: [{ started_at: 9000 }], delegation: { state: 'completed' }, now }), 'finished');
  assert.equal(subagentState({ call: bg, segments: [{ started_at: 9000 }], delegation: { state: 'error' }, now }), 'error');
  assert.equal(subagentState({ call: { ...bg, ts: now - 10 }, segments: [], now }), 'running'); // dispatched, row not written yet
  assert.equal(subagentState({ call: bg, segments: [{ started_at: 100, last_activity_at: 200 }], now: 200 + 7 * 3600 }), 'unknown');
  assert.equal(subagentState({ call: { background: false, ts: 1, resultTs: 2, taskStatus: 'failed' }, segments: [{ started_at: 1 }], now }), 'error');
  assert.equal(subagentState({ call: { failed: 'refused' }, now }), 'error');
});

test('terminal state: exit code, ended session, pid alive or gone, foreground in progress', () => {
  const now = 10_000;
  assert.equal(terminalState({ call: { exitCode: 0 }, now }), 'finished');
  assert.equal(terminalState({ call: { exitCode: 2 }, now }), 'error');
  assert.equal(terminalState({ call: { pid: 5, resultTs: 1 }, session: { ended_at: 50, end_reason: 'cli_close' }, now }), 'finished');
  assert.equal(terminalState({ call: { pid: 5, resultTs: 1 }, session: { started_at: 2 }, pidAlive: true, now }), 'running');
  assert.equal(terminalState({ call: { pid: 5, resultTs: 1 }, session: null, pidAlive: false, now }), 'error');
  assert.equal(terminalState({ call: { ts: now - 30 }, now }), 'running'); // foreground, no result yet
});

// ---------- views ----------

test('view: Paseo agent shape with provider hermes; ids round-trip', () => {
  const c = { kind: 'terminal', query: '$(cat ~/s/task4.md)', ts: 100, match: 'time', command: 'hermes -p support chat …' };
  const v = childView(c, { session: { id: 'local-1', started_at: 101, model: 'm' }, state: 'running', profile: 'support' });
  assert.equal(v.id, 'hermes:support:local-1');
  assert.deepEqual([v.provider, v.kind, v.state, v.rel, v.account, v.match, v.title], ['hermes', 'terminal', 'running', 'created', 'support', 'time', 'hermes chat · task4.md']);
  assert.deepEqual(parseChildId(v.id), { profile: 'support', ref: 'local-1' });
  assert.deepEqual(parseChildId('hermes:default:abc'), { profile: null, ref: 'abc' });
  assert.equal(parseChildId('8677dc6f-53dc-40e4-9d00-a4239d141cdd'), null);
  const s = childView({ kind: 'subagent', goal: 'Audit Gmail', subagentId: 'sa-0-a', ts: 1 }, { session: null, state: 'running' });
  assert.deepEqual([s.id, s.title], ['hermes:default:sa-0-a', 'Audit Gmail']);
});

test('timeline: user, assistant, tool calls with their results', () => {
  const items = childTimeline([
    { role: 'user', content: 'Do X', timestamp: 1 },
    { role: 'assistant', content: 'On it', tool_calls: JSON.stringify([call('c1', 'terminal', { command: 'ls' })]), timestamp: 2 },
    { role: 'tool', tool_name: 'terminal', tool_call_id: 'c1', content: 'a b c', timestamp: 3 },
    { role: 'assistant', content: 'Done', timestamp: 4 },
  ]);
  assert.deepEqual(items.map((i) => [i.role, i.text || i.summary, i.status ?? null]), [
    ['user', 'Do X', null], ['assistant', 'On it', null], ['tool', 'a b c', 'completed'], ['assistant', 'Done', null],
  ]);
});
