// N6: Hermes' own turn is over, but agents the chat started or steers still work: the card stays in
// Doing (or Waiting while one waits for a permission). Agents are Paseo agents and Hermes' own child
// agents (delegate_task subagents, terminal `hermes chat` runs; provider 'hermes'), same rule for both.

const ORDER = { 'needs-attention': 0, running: 1, error: 2, finished: 3, idle: 4, closed: 5, unknown: 6, archived: 7 };
const REL_RANK = { created: 3, steers: 2, watches: 1 };

/** Agents in the order the UI lists them: blocked, running, failed, done; started before steered. */
export const sortAgents = (list) => [...list].sort((a, b) => (ORDER[a.state] ?? 5) - (ORDER[b.state] ?? 5) || (REL_RANK[b.rel] ?? 0) - (REL_RANK[a.rel] ?? 0));

/** Agents that keep a chat busy: started or steered by it (not only watched), not archived. */
export const ownedAgents = (agents) => (agents || []).filter((a) => a.rel !== 'watches' && !a.archived);

/**
 * Column and note for a card from Hermes' own column and the chat's agents.
 * @param {{ autoColumn: string, column: string, overridden: boolean, pending: number, system: boolean, agents: object[], t: (key: string, vars?: object) => string }} o
 * @returns {{ column: string, note: string }}
 */
export function agentColumn({ autoColumn, column, overridden, pending, system, agents, t }) {
  const owned = ownedAgents(agents);
  const blocked = owned.filter((a) => a.state === 'needs-attention');
  const busy = owned.filter((a) => a.state === 'running');
  let note = '';
  if (pending || system || (autoColumn !== 'waiting' && autoColumn !== 'doing')) return { column, note };
  // Paseo-only wording stays as it was; as soon as a Hermes child runs, the note says "agents".
  const k = busy.some((a) => a.provider === 'hermes') ? 'agents' : 'paseo';
  if (blocked.length) {
    note = t('paseoBlocked', { title: blocked[0].title });
    if (autoColumn === 'waiting' && !overridden) column = 'waiting';
  } else if (busy.length && autoColumn === 'waiting') {
    note = t(`${k}RunningList`, { n: busy.length, titles: busy.map((a) => a.title).join(', ') });
    if (!overridden) column = 'doing';
  } else if (busy.length) {
    note = t(`${k}Running`, { n: busy.length });
  }
  return { column, note };
}

/** Whether a chat still counts as busy for the inbox's done rule (same rule as the columns). */
export const agentsBusy = (agents) => ownedAgents(agents).some((a) => a.state === 'running' || a.state === 'needs-attention');
