# 0013: Hermes' own child agents are shown like Paseo agents

- **Status:** Proposed
- **Date:** 2026-11

## Context

A Hermes chat often hands work to agents of its own instead of (or next to) Paseo agents:

1. **`delegate_task` subagents.** Hermes runs them in-process, usually in the background, each with
   its own conversation.
2. **Terminal runs of Hermes itself:** `hermes [-p <profile>] chat -q …` (or `--query-file`) started
   through the terminal tool, often with `background=true`, sometimes in another profile.
3. **Background processes:** any other terminal command with `background=true`, or a foreground call
   Hermes promoted to a tracked process (result with `promoted_from_foreground`, `session_id: proc_…`),
   e.g. a `paseo send` plus a poll loop, a render, a long export.

The board did not see either. A chat whose turn ended went to Waiting although work it started was
still running, and their transcripts were not reachable from the chat.

What Hermes stores (read-only, `state.db` and `profiles/<name>/state.db`):

| | Subagent (`delegate_task`) | Terminal run (`hermes chat -q`) |
|---|---|---|
| Child session | own `sessions` row, `source='subagent'`, `parent_session_id` = the chat, `model_config._subagent_id` (newer Hermes) | own row, `source='oneshot'`, **no parent id**, in the profile's own `state.db` with `-p` |
| Link in the chat | the call's arguments (`tasks[].goal`); the result has `subagent_ids` + `delegation_id` (background) or `results[].task_index` (synchronous) | the call's `command`; the result has the process id `proc_…` and the `pid` |
| Finished | child row `ended_at`; `async_delegations.state` (`completed` / `error`) | `process_complete` notice in the chat (with the exit code); child row `ended_at` |

The `HERMES_SESSION_*` variables reach the child process, but `hermes chat` does not record them, so
a terminal run cannot be tied to its chat by an id without a change to Hermes.

## Decision

- The backend derives a chat's child agents from the chat's own transcript (`server/src/hermes-children.mjs`,
  pure and tested; `server/src/hermes-agents.mjs` adds the databases, a cache and the process check)
  and serves them **in the same list and shape as Paseo agents** (`Session.paseo[]`, `provider: 'hermes'`,
  `kind: 'subagent' | 'terminal' | 'process'`). Inline cards sit right after the message whose tool call started
  them; the transcript is read-only from the child session(s) (`GET /api/agents/hermes:<profile>:<id>/timeline`).
- **Matching, strongest first** (field `match`):
  - `id`: subagent id from the result = `_subagent_id` of the child row (hard).
  - `goal`, `order`: children of the chat (`parent_session_id`, hard) in the call's time window, by the
    task's goal in the child's first message, else in task order (synchronous calls, results Hermes
    compacted, older Hermes without `_subagent_id`).
  - `prompt`: terminal run, the child's first message equals the `-q` text or the prompt file's content
    (prefix match from 20 characters). **Heuristic**, shown as such in the UI.
  - `time`: terminal run, the only `oneshot` session of that database that started within 60 s after
    the call. **Heuristic**, shown as such. Two candidates and no prompt match: no guess, the agent is
    shown without a transcript.
- **State from data only:** exit code (result or completion notice), child `ended_at` / `end_reason`,
  `async_delegations.state`, and for background terminal runs whether the `pid` from the result is
  alive (`kill(pid, 0)`, which sends nothing). A row that is open but proves nothing any more (no
  delegation record, no activity for 6 h) is `unknown`, not `running`.
- **Background processes** (`kind: 'process'`) have no session: they run from the tool result
  (`session_id` `proc_…`, `pid`) until the `process_complete` notice with the same `proc_…` id (exit
  code). Without a notice: `running` while the `pid` is alive, `unknown` when it is gone or after 6 h,
  so a lost notice or a reused pid never keeps a card in Doing. Title: the first comment line of the
  command, else the command without its `VAR=…;` / `cd …&&` set-up. The transcript is the command and
  the notice.
- **Doing rule** (`server/src/agent-column.mjs`, tested): unchanged from 0010 and now shared by both
  providers: a chat whose turn is over stays in Doing while an agent it started runs. The note reads
  "Agents running (n)" as soon as a Hermes child is among them ("Background processes running (n)"
  when only background processes run).
- Running children are re-checked every 5 s (a process can end without a write to the main `state.db`,
  and profile databases are not part of the poll).

## Consequences

- Nothing is written under `HERMES_HOME`; profile databases are opened read-only and only when a call
  names the profile.
- A terminal run is tied to its chat by time and prompt. Two runs with the same prompt started within
  a second could be swapped; the UI marks these links as heuristic.
- `delegate_task` steer / list calls do not create agents. Paseo-only features (permissions, deep
  link, "account") stay Paseo-only.

## Alternatives considered

- **Patch Hermes** so `hermes chat` records `parent_session_id` from `HERMES_SESSION_ID` (or a
  `--parent` flag): would make terminal runs a hard link. Not done here (Hermes is not ours to change);
  listed in the open questions.
- **Read Hermes' process registry** (`processes.json`): only persistent background processes are listed,
  and it says nothing about the child session. Not needed: the pid from the result answers "alive?".
