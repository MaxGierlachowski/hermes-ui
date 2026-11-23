import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkRel, mergeLink, outputIds, paseoCliCalls, paseoTerminal } from '../src/paseo-cli.mjs';

const ID = '98413df6-9375-4819-9d11-7252746a4028';
const OLD = '4057dd31-fc6e-4382-ad35-a805866adb50';
const BIN = '/Applications/Paseo.app/Contents/Resources/bin/paseo';

// ---------- CLI calls ----------

test('paseo CLI: send steers, logs / inspect watch, ids from arguments (full or prefix)', () => {
  assert.deepEqual(paseoCliCalls(`${BIN} send --no-wait ${ID} "Nachtrag: bitte einarbeiten"`), [{ sub: 'send', rel: 'steers', ref: ID, creates: false }]);
  assert.deepEqual(paseoCliCalls(`sleep 30; ${BIN} logs 98413df6 | tail -4`).map((c) => [c.sub, c.rel, c.ref]), [['logs', 'watches', '98413df6']]);
  assert.deepEqual(paseoCliCalls(`paseo --json inspect ${ID}`).map((c) => [c.sub, c.ref]), [['inspect', ID]]);
  assert.deepEqual(paseoCliCalls(`paseo agent logs ${ID}`).map((c) => [c.sub, c.ref]), [['logs', ID]]);
  assert.deepEqual(paseoCliCalls(`paseo --host 127.0.0.1:6767 archive ${ID}`).map((c) => [c.sub, c.rel, c.ref]), [['archive', 'steers', ID]]);
});

test('paseo CLI: P=… / ID=… set in the same command, quoted or braced, also over several lines', () => {
  const cmd = `P=${BIN}; ID=${OLD}; $P send --no-wait $ID "Nachtrag 3 von Max" && for i in $(seq 1 19); do sleep 30; s=$($P inspect $ID | awk '/^Status/{print $2}'); [ "$s" = idle ] && break; done; echo $s; $P logs $ID | tail -15`;
  assert.deepEqual(paseoCliCalls(cmd).map((c) => [c.sub, c.rel, c.ref]), [['send', 'steers', OLD], ['inspect', 'watches', OLD], ['logs', 'watches', OLD]]);
  assert.deepEqual(paseoCliCalls(`P="${BIN}"\nID=${ID}\n"\${P}" wait "\${ID}"`).map((c) => [c.sub, c.ref]), [['wait', ID]]);
});

test('paseo CLI: run creates (no ref), ls names none; not a call: other words, other binaries', () => {
  assert.deepEqual(paseoCliCalls(`paseo run --json "Fix the build"`), [{ sub: 'run', rel: 'steers', ref: null, creates: true }]);
  assert.deepEqual(paseoCliCalls('paseo ls -a'), [{ sub: 'ls', rel: 'watches', ref: null, creates: false }]);
  assert.deepEqual(paseoCliCalls(`echo paseo send ${ID}`), []);
  assert.deepEqual(paseoCliCalls(`grep -rn "paseo logs ${ID}" docs/`), []);
  assert.deepEqual(paseoCliCalls(`paseo-mcp send ${ID}`), []);
  assert.deepEqual(paseoCliCalls('paseo daemon restart'), []);
});

test('terminal commands: which may create an agent, which ids they name themselves', () => {
  assert.equal(paseoTerminal('node ~/tools/paseo-mcp/start_weekly_tmp.mjs "Weekly KW48" weekly').creates, true);
  assert.equal(paseoTerminal('cd ~/.hermes/cache/scratch && python3 paseo_oneshot_hui.py').creates, true);
  assert.equal(paseoTerminal(`node -e "const a = await client.agents.create({ title: 'x' }); console.log(a.id)"`).creates, true);
  assert.equal(paseoTerminal('paseo run "Fix it"').creates, true);
  assert.equal(paseoTerminal('paseo ls').creates, false);
  assert.equal(paseoTerminal(`paseo logs ${ID}`).creates, false);
  assert.equal(paseoTerminal('ls -la && git status').creates, false);
  const t = paseoTerminal(`P=${BIN}; ID=${OLD}; $P send --no-wait $ID "x"; cat paseo.json | grep ${ID}`);
  assert.deepEqual(t.refs, [{ ref: OLD, rel: 'steers' }]);
  assert.deepEqual(t.named.sort(), [OLD, ID].sort());
});

// ---------- ids in a terminal result ----------

test('output ids: from the {"output": …} JSON (paseo-mcp over stdio), minus ids the command named', () => {
  // Real shape: a Python script talking to paseo-mcp over stdio, its JSON-RPC answer on stdout.
  const content = JSON.stringify({
    output: JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({ id: ID, account: 'bot-03', hint: 'Running.' }, null, 2) }] }, jsonrpc: '2.0', id: 2 }),
    exit_code: 0, error: null, cwd: '/tmp',
  });
  assert.deepEqual(outputIds(content), [ID]);
  assert.deepEqual(outputIds(content, ['98413df6']), []);
  assert.deepEqual(outputIds(`${ID}\n`), [ID]); // plain stdout of a Node client printing the new id
});

// ---------- links ----------

test('links: the strongest rel wins; strict only while every source was strict', () => {
  let l = mergeLink(undefined, 'watches', 10, { strict: true });
  l = mergeLink(l, 'steers', 20, { strict: true });
  assert.deepEqual(l, { rel: 'steers', at: 10, strict: true, window: null, orRel: null });
  l = mergeLink(l, 'watches', 30);
  assert.equal(l.rel, 'steers');
  assert.equal(l.strict, false);
});

test('links: "created" from an output holds only inside the window, else falls back to what came before', () => {
  const win = { strict: true, window: [100, 140] };
  const created = mergeLink(undefined, 'created', 100, win);
  assert.equal(linkRel(created, new Date(120 * 1000).toISOString()), 'created');
  assert.equal(linkRel(created, new Date(50 * 1000).toISOString()), null); // an older agent the script only printed
  assert.equal(linkRel(created, null), null);
  const steered = mergeLink(mergeLink(undefined, 'steers', 90, { strict: true }), 'created', 100, win);
  assert.equal(linkRel(steered, new Date(50 * 1000).toISOString()), 'steers');
  const later = mergeLink(created, 'watches', 150, { strict: true });
  assert.equal(linkRel(later, new Date(50 * 1000).toISOString()), 'watches');
  const confirmed = mergeLink(created, 'created', 160); // paseo_create_agent named it too
  assert.equal(linkRel(confirmed, null), 'created');
});
