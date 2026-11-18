import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callsOf, paseoItem, paseoTool } from '../src/paseo-calls.mjs';

const ID = '8677dc6f-53dc-40e4-9d00-a4239d141cdd';
const wrap = (src, body) => `<untrusted_tool_result source="${src}">\nThe following content …\n\n${body}\n</untrusted_tool_result>`;
const created = wrap('mcp__paseo__paseo_create_agent', `{"result": "{\\n  \\"id\\": \\"${ID}\\",\\n  \\"account\\": \\"01\\",\\n  \\"hint\\": \\"Running.\\"\\n}"}`);

test('tool names: mcp prefix, plain name, others', () => {
  assert.equal(paseoTool('mcp__paseo__paseo_create_agent'), 'create_agent');
  assert.equal(paseoTool('paseo_send_message'), 'send_message');
  assert.equal(paseoTool('terminal'), null);
  assert.equal(paseoTool('tool_call'), null);
});

test('create through the tool_call wrapper: id and account from the result, title from the arguments', () => {
  const calls = callsOf(JSON.stringify([{ id: 'toolu_1', type: 'function', function: { name: 'tool_call', arguments: JSON.stringify({ calls: [{ name: 'mcp__paseo__paseo_create_agent', arguments: { title: 'Fix X', account: '02', prompt: '…' } }] }) } }]));
  const item = paseoItem({ tool_name: 'mcp__paseo__paseo_create_agent', tool_call_id: 'toolu_1', content: created }, calls);
  assert.deepEqual(item, { action: 'create', ref: ID, title: 'Fix X', account: '02' });
});

test('wrapper calls stored as a JSON string, two calls of one tool in one batch keep their order', () => {
  const inner = JSON.stringify([
    { name: 'mcp__paseo__paseo_send_message', arguments: { agent_id: 'aaaa1111', text: 'erste\nNachricht' } },
    { name: 'mcp__paseo__paseo_send_message', arguments: { agent_id: 'bbbb2222', text: 'zweite' } },
  ]);
  const calls = callsOf(JSON.stringify([{ id: 't2', function: { name: 'tool_call', arguments: JSON.stringify({ calls: inner }) } }]));
  const seen = new Map();
  const row = { tool_name: 'mcp__paseo__paseo_send_message', tool_call_id: 't2', content: wrap('x', '{"result": "ok"}') };
  assert.deepEqual(paseoItem(row, calls, seen), { action: 'message', ref: 'aaaa1111', text: 'erste Nachricht' });
  assert.deepEqual(paseoItem(row, calls, seen), { action: 'message', ref: 'bbbb2222', text: 'zweite' });
});

test('direct call (no wrapper) and archive', () => {
  const calls = callsOf(JSON.stringify([{ id: 't3', function: { name: 'mcp__paseo__paseo_archive_agent', arguments: JSON.stringify({ agent_id: ID }) } }]));
  assert.deepEqual(paseoItem({ tool_name: 'mcp__paseo__paseo_archive_agent', tool_call_id: 't3', content: '{"result":"archived"}' }, calls), { action: 'archive', ref: ID });
});

test('a failed create and read-only calls are not inline items', () => {
  assert.equal(paseoItem({ tool_name: 'mcp__paseo__paseo_create_agent', tool_call_id: 'x', content: wrap('x', '{"error": "MCP call interrupted"}') }, new Map()), null);
  assert.equal(paseoItem({ tool_name: 'mcp__paseo__paseo_read_timeline', tool_call_id: 'x', content: ID }, new Map()), null);
});

test('create without arguments still finds the id; account falls back to the result', () => {
  assert.deepEqual(paseoItem({ tool_name: 'mcp__paseo__paseo_create_agent', tool_call_id: 'gone', content: created }, new Map()), { action: 'create', ref: ID, title: null, account: '01' });
});
