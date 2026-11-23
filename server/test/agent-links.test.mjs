import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentColumn } from '../src/agent-column.mjs';
import { extraLinks, labelSessions, mergeCardLinks, predecessorRef, resolveRef } from '../src/agent-links.mjs';

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const C = 'cccccccc-3333-4333-8333-333333333333';
const D = 'dddddddd-4444-4444-8444-444444444444';
const agents = (obj) => new Map(Object.entries(obj).map(([id, labels]) => [id, { id, labels }]));
const none = () => [];
const plain = (r) => Object.fromEntries([...r.bySession].map(([sid, m]) => [sid, Object.fromEntries(m)]));

test('labels: origin_ref, hermes_chat_id and hermes_session_id name a session; unknown ids are ignored', () => {
  const known = new Set(['s1', 's2']);
  assert.deepEqual(labelSessions({ origin_ref: 's1', hermes_chat_id: 's2', hermes_session_id: 's1', other: 's2' }, (id) => known.has(id)), ['s1', 's2']);
  assert.deepEqual(labelSessions({ origin_ref: 'slack:C123' }, (id) => known.has(id)), []);
  assert.deepEqual(labelSessions(null), []);
});

test('a label links the agent to that session with rel created', () => {
  const r = extraLinks({ agents: agents({ [A]: { hermes_session_id: 's1' } }), direct: none });
  assert.deepEqual(plain(r), { s1: { [A]: { rel: 'created', via: 'label', successorOf: null } } });
});

test('agents without labels or manual links add nothing (existing behaviour unchanged)', () => {
  const r = extraLinks({ agents: agents({ [A]: {}, [B]: { account: 'x', kind: 'fix' } }), direct: () => [{ sessionId: 's1', rel: 'created' }] });
  assert.equal(r.bySession.size, 0);
});

test('predecessor refs: full id or a prefix of at least 6 hex characters', () => {
  assert.equal(predecessorRef({ predecessor: A.toUpperCase() }), A);
  assert.equal(predecessorRef({ predecessor: 'aaaaaaaa' }), 'aaaaaaaa');
  assert.equal(predecessorRef({ predecessor: 'abc' }), null);
  assert.equal(predecessorRef({ predecessor: 'not an id' }), null);
  assert.equal(resolveRef('aaaa', [A, 'aaaa0000-0000-4000-8000-000000000000']), null); // ambiguous
  assert.equal(resolveRef('aaaaaaaa-1', [A, B]), A);
  assert.equal(resolveRef(C, [A]), C); // a full id stands for itself
});

test('a successor inherits its predecessor\'s transcript links, by prefix, with the predecessor\'s rel', () => {
  const direct = (id) => (id === A ? [{ sessionId: 's1', rel: 'created' }, { sessionId: 's2', rel: 'watches' }] : []);
  const r = extraLinks({ agents: agents({ [A]: {}, [B]: { predecessor: 'aaaaaaaa' } }), direct });
  assert.deepEqual(plain(r), {
    s1: { [B]: { rel: 'created', via: 'successor', successorOf: A } },
    s2: { [B]: { rel: 'watches', via: 'successor', successorOf: A } },
  });
});

test('chains of restarts inherit recursively; label and manual links of predecessors count too', () => {
  const direct = (id) => (id === A ? [{ sessionId: 's1', rel: 'steers' }] : []);
  const r = extraLinks({
    agents: agents({ [A]: {}, [B]: { predecessor: A, origin_ref: 's2' }, [C]: { predecessor: 'bbbbbbbb' } }),
    direct,
    manual: { s3: { [B]: { at: 1 } } },
  });
  const p = plain(r);
  assert.deepEqual(p.s1[C], { rel: 'steers', via: 'successor', successorOf: B });
  assert.deepEqual(p.s2[C], { rel: 'created', via: 'successor', successorOf: B });
  assert.deepEqual(p.s3[C], { rel: 'created', via: 'successor', successorOf: B });
  assert.deepEqual(p.s2[B], { rel: 'created', via: 'label', successorOf: A });
  assert.deepEqual(p.s1[B], { rel: 'steers', via: 'successor', successorOf: A });
});

test('predecessor cycles and self references end the chain', () => {
  const direct = (id) => [{ sessionId: `of-${id.slice(0, 1)}`, rel: 'created' }];
  const r = extraLinks({ agents: agents({ [A]: { predecessor: B }, [B]: { predecessor: A }, [C]: { predecessor: C } }), direct });
  const p = plain(r);
  assert.deepEqual(Object.keys(p['of-b']), [A]);
  assert.deepEqual(Object.keys(p['of-a']), [B]);
  assert.equal(p['of-c'], undefined);
});

test('an archived predecessor not loaded yet still passes on its links and is reported as missing', () => {
  const direct = (id) => (id === D ? [{ sessionId: 's1', rel: 'created' }] : []);
  const r = extraLinks({ agents: agents({ [B]: { predecessor: 'dddddd' } }), direct, knownIds: [D] });
  assert.deepEqual(plain(r), { s1: { [B]: { rel: 'created', via: 'successor', successorOf: D } } });
  assert.deepEqual([...r.missing], [D]);
});

test('lineage: links to a child or continued session count for its root', () => {
  const rootOf = (id) => ({ child: 'root', grandchild: 'root' }[id] || id);
  const direct = (id) => (id === A ? [{ sessionId: 'grandchild', rel: 'created' }] : []);
  const r = extraLinks({ agents: agents({ [A]: {}, [B]: { predecessor: A }, [C]: { hermes_chat_id: 'child' } }), direct, rootOf });
  assert.deepEqual(Object.keys(plain(r).root).sort(), [B, C]);
});

test('manual attach works for agents the daemon does not list (yet); the best rel wins per session', () => {
  const r = extraLinks({ agents: agents({ [A]: { origin_ref: 's1' } }), direct: none, manual: { s1: { [A]: { at: 1 } }, s2: { [D]: { at: 2 } } } });
  assert.deepEqual(plain(r), {
    s1: { [A]: { rel: 'created', via: 'manual', successorOf: null } },
    s2: { [D]: { rel: 'created', via: 'manual', successorOf: null } },
  });
});

test('card links: no extra links leave the transcript links exactly as they were', () => {
  const transcript = new Map([[A, { rel: 'created', linkedAt: 10 }], [B, { rel: 'watches', linkedAt: 20 }]]);
  assert.deepEqual([...mergeCardLinks(transcript, undefined)], [[A, { rel: 'created', linkedAt: 10, via: 'transcript' }], [B, { rel: 'watches', linkedAt: 20, via: 'transcript' }]]);
});

test('card links: a better rel or a manual attach replaces the transcript link; detach removes any link', () => {
  const transcript = new Map([[A, { rel: 'watches', linkedAt: 10 }], [B, { rel: 'created', linkedAt: 20 }]]);
  const extra = new Map([[A, { rel: 'created', via: 'successor' }], [B, { rel: 'created', via: 'label' }], [C, { rel: 'created', via: 'manual' }]]);
  const m = mergeCardLinks(transcript, extra);
  assert.deepEqual(m.get(A), { rel: 'created', linkedAt: 10, via: 'successor' });
  assert.deepEqual(m.get(B), { rel: 'created', linkedAt: 20, via: 'transcript' });
  assert.deepEqual(m.get(C), { rel: 'created', linkedAt: null, via: 'manual' });
  const d = mergeCardLinks(transcript, extra, { [B]: { at: 1 }, [C]: { at: 1 } });
  assert.deepEqual([...d.keys()], [A]);
});

test('end to end: the chat\'s own agent is archived after a limit, its successor from another run keeps the card in Doing', () => {
  // The chat created A (transcript); A hit a limit and was archived; another run started B with predecessor=A.
  const transcript = new Map([[A, { rel: 'created', linkedAt: 1 }]]);
  const { bySession } = extraLinks({ agents: agents({ [A]: {}, [B]: { predecessor: A.slice(0, 8) } }), direct: (id) => (id === A ? [{ sessionId: 'chat', rel: 'created' }] : []) });
  const state = { [A]: { state: 'archived', archived: true }, [B]: { state: 'running', archived: false } };
  const list = [...mergeCardLinks(transcript, bySession.get('chat'))].map(([id, l]) => ({ id, title: id.slice(0, 1), ...l, ...state[id] }));
  const t = (k, v = {}) => `${k}:${v.n ?? ''}`;
  assert.deepEqual(agentColumn({ autoColumn: 'waiting', column: 'waiting', overridden: false, pending: 0, system: false, agents: list, t }), { column: 'doing', note: 'paseoRunningList:1' });
  // Without the successor link the same card would wait.
  const alone = [...mergeCardLinks(transcript, undefined)].map(([id, l]) => ({ id, ...l, ...state[id] }));
  assert.equal(agentColumn({ autoColumn: 'waiting', column: 'waiting', overridden: false, pending: 0, system: false, agents: alone, t }).column, 'waiting');
});
