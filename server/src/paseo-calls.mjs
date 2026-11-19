// Paseo tool calls inside a Hermes transcript, for the inline agent cards in the thread.
// Hermes calls paseo-mcp directly (mcp__paseo__paseo_create_agent) or through its deferred-tool wrapper
// `tool_call` ({ calls: [{ name, arguments }] }, `calls` sometimes stored as a JSON string). Either way
// the tool row carries the inner tool name and the wrapper's tool_call_id; the new agent's id is in the
// result, the other calls name it in their arguments (agent_id, may be a prefix).

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ID_RE = /\\?"id\\?"\s*:\s*\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Tool (short name) -> what the thread shows. Read-only calls (get_agent, read_timeline, …) stay tool chips.
export const PASEO_ACTIONS = { create_agent: 'create', send_message: 'message', archive_agent: 'archive', respond_permission: 'permission' };

export const paseoTool = (name) => String(name || '').split('__').pop().match(/^paseo_([a-z_]+)$/)?.[1] || null;

const parseArgs = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
};

/** tool_call_id -> [{ name, args }] from one assistant row's tool_calls (wrapper calls flattened). */
export function callsOf(toolCallsJson) {
  const out = new Map();
  let calls = [];
  try { calls = JSON.parse(toolCallsJson || '[]'); } catch { return out; }
  for (const c of Array.isArray(calls) ? calls : []) {
    const name = c?.function?.name || c?.name || '';
    const args = parseArgs(c?.function?.arguments ?? c?.arguments);
    let list = [{ name, args }];
    if (name === 'tool_call') {
      let inner = args.calls;
      if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { inner = []; } }
      if (!Array.isArray(inner) && args.name) inner = [{ name: args.name, arguments: args.arguments }];
      list = (Array.isArray(inner) ? inner : []).map((x) => ({ name: x?.name || '', args: parseArgs(x?.arguments) }));
    }
    if (c?.id) out.set(c.id, list);
  }
  return out;
}

/**
 * The inline item for one tool row, or null when it is not a Paseo action worth showing inline.
 * @param {{ tool_name: string, tool_call_id?: string, content: string }} row
 * @param {Map<string, {name: string, args: object}[]>} calls  from callsOf() of the preceding assistant rows
 * @param {Map<string, number>} seen  per tool_call_id+tool, how many rows were already matched (batches)
 */
export function paseoItem(row, calls, seen = new Map()) {
  const tool = paseoTool(row.tool_name);
  const action = PASEO_ACTIONS[tool];
  if (!action) return null;
  const key = `${row.tool_call_id}|${tool}`;
  const n = seen.get(key) || 0;
  seen.set(key, n + 1);
  const args = (calls.get(row.tool_call_id) || []).filter((c) => paseoTool(c.name) === tool)[n]?.args || {};
  const content = String(row.content || '');
  if (action === 'create') {
    const id = content.match(ID_RE)?.[1] || null;
    if (!id) return null; // failed create (error result): the plain tool chip shows what happened
    const account = args.account || content.match(/\\?"account\\?"\s*:\s*\\?"([^"\\]+)/)?.[1] || null;
    return { action, ref: id, title: args.title ? String(args.title).slice(0, 200) : null, account };
  }
  const ref = String(args.agent_id || '').trim() || content.match(UUID_RE)?.[0] || '';
  if (!ref) return null;
  const item = { action, ref };
  if (action === 'message' && args.text) item.text = String(args.text).replace(/\s+/g, ' ').trim().slice(0, 160);
  return item;
}
