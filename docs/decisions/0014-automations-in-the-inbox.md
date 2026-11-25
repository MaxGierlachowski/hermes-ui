# 0014: Cron runs, webhook runs and script messages in the inbox

- **Status:** Accepted
- **Date:** 2026-11

## Context

Hermes cron jobs, webhook runs and small scripts usually report to a chat channel. That channel should
go away: everything that reports something should arrive in the Hermes UI inbox instead, with push to
the phone, grouped by job, and with a jump into the run's chat when there is one.

Cron and webhook sessions are deliberately hidden from the board (`systemSources` in `store.mjs`,
`DELIVERY_RE` in `user-markers.mjs`): there are thousands of them a week (on one test machine about
8,900 cron and 1,200 webhook sessions in 7 days), and almost all are silent: `[SILENT]`, "no_change",
empty output. The inbox must show only the runs that actually reported something, and decide that from
Hermes' own data, read-only, without guessing from the text.

Hermes keeps several records of a cron run (`$HERMES_HOME/cron/`), checked against a live installation:

- `deliveries.db` (`deliveries`): `content` and `job_json` are empty, and jobs with `deliver: local` get
  no useful row. Not usable.
- `executions.db` (`executions`): pruned to about 1,000 rows; `delivery_outcome` is `suppressed` both for
  silent runs and for `deliver: local`, so the two cannot be told apart. Not usable.
- `output/<job_id>/<timestamp>.md`: the run archive. Hermes writes one for every run of every job,
  whatever its `deliver` target, with a header (`# Cron Job: <name>`, `**Job ID:**`, `**Mode:**`, and
  `**Status:**` for runs that were suppressed or failed before the agent ran) and, for agent runs, the
  response in a length frame (`**Response Characters:** <n>`). Hermes reads these archives itself
  (`context_from`, `cron/scheduler_prompt.py`).
- `state.db` `sessions`: agent runs only (scripts have no session); cron titles `<job name> · <date>`,
  webhook runs `source = 'webhook'` with `origin_json.chat_name = "webhook/<route>"`.

## Decision

1. **Cron runs come from the run archives**, webhook runs from `state.db`. The backend scans both every
   15 s (`server/src/automations.mjs`), read-only, and adds an inbox entry of kind `automation`
   (`source` `cron` / `webhook`, `group` = current job name or route, `status` ok / error, `body` = the
   report as Markdown, `sessionId` when there is a chat).
2. **"Reported something"** is decided by Hermes' own markers, in this order:
   - header `**Status:** silent …` / `no_change …`, or `Script gate returned wakeAgent=false`: silent;
   - any other `**Status:**` (`BLOCKED (configuration)`, `script failed`, …), a `(FAILED)` title with
     an `## Error` section, `(No response generated)`, the `[CRON_FAILURE]` marker on the first line of
     the response, or Hermes' "removed before firing" note: **error** (title = the status, the
     exception line or the agent's failure evidence);
   - a response that is Hermes' silence sentinel: silent. The matcher is a port of
     `is_autonomous_silence_response` (`gateway/response_filters.py`): `[SILENT]`, `SILENT`, `NO_REPLY`
     and the forms Hermes accepts (code-wrapped, punctuation, one typo). No other text heuristics;
   - any other response or non-empty script output: **ok**.
   - Webhooks: a final assistant reply that is not silent is ok; no reply with an end other than
     `webhook_complete` is an error; no reply otherwise is silent.
3. **The response frame is validated from the end.** Hermes jumps over the prompt by its stamped length,
   but that stamp is often off (on the test machine for about 400 of 550 agent archives; Hermes' own
   reader then finds no answer either). The response is the last section and its own length frame must
   cover exactly the rest of the document, so it is found from the end when the jump misses.
4. **Agent runs link to their chat:** the cron session whose title starts with the job name (or whose id
   is `cron_<job id>_…`), started before the archive was written, whose final reply equals the archived
   answer; else the one that ended within 5 minutes. No-agent scripts have no chat.
5. **Idempotent across restarts:** entry ids come from the run (`cron:<job>:<archive>`,
   `webhook:<session>`); a cursor in `<data-dir>/automations.json` remembers how far the scan got. The
   first start begins at "now" (`HERMES_UI_AUTOMATIONS_BACKFILL_HOURS` reaches back N hours), so old runs
   never flood the inbox. Archives become visible by rename after they were written, so the scan looks
   10 minutes behind the cursor and remembers what it saw there.
6. **The same error again** (same source, group, title and text) is folded into the newest entry of its
   group: a repeat counter, the newer time, unread again, one push. A job that fails every 5 minutes is
   one entry, not hundreds.
7. **`POST /api/notify`** (and `hermes-ui notify`) is the way for scripts and other Hermes profiles on the
   same machine: `{title, text?, group?, level?, sessionId?, url?}`, at most 64 KB, the board token or a
   notify-only token (`HERMES_UI_NOTIFY_TOKEN`) that can call nothing else. Source `notify`, level
   `error` counts as a failure.
8. **Continuing in a cron or webhook chat works:** Hermes' gateway (`tui_gateway`, `session.resume` +
   `prompt.submit`) does not check a session's source or end reason; the first prompt reopens it. So
   "Open chat" opens the normal thread with the composer, as for any chat.
9. **Push:** three switches per device, all on by default: *automations* (reports), *automation errors*
   (failures, notify level error), *notify*. Quiet hours and "not while visible" apply. Title = group,
   body = the entry's one-line title (more than the chat pushes carry, on purpose: it replaces the chat
   channel; switch it off per device). A tap opens the run's chat, or the entry in the inbox
   (`#/inbox/item/<id>`).
10. **The board stays clean:** cron and webhook sessions remain hidden there.

## Consequences

- Works for every `deliver` target, including `deliver: local`, without any change to Hermes and
  without writing under `$HERMES_HOME`.
- Depends on the archive format (`cron/scheduler.py`, `cron/scheduler_prompt.py`); a format change
  shows up as unexpected errors ("Run archive unreadable") rather than silently lost reports, and is
  covered by fixture tests (`server/test/automations.test.mjs`).
- Webhook reports are as frequent as Hermes' webhook replies; `HERMES_UI_AUTOMATIONS_IGNORE` leaves out
  noisy jobs or routes. Retention is the inbox's (`HERMES_UI_INBOX_DAYS`, `HERMES_UI_INBOX_MAX`); with
  many automations a larger `HERMES_UI_INBOX_MAX` keeps more chat history.

## Alternatives considered

- **`deliveries.db` / `executions.db`:** empty content, pruned, `suppressed` ambiguous (see Context).
- **A delivery target in Hermes that posts to Hermes UI:** would need changes to Hermes' configuration
  per job and misses `deliver: local`; Hermes UI does not write Hermes' configuration.
- **All cron / webhook sessions as inbox entries:** thousands a week, almost all silent.
- **Text heuristics ("nothing to report", "no changes"):** language-dependent and unreliable; only
  Hermes' documented silence marker counts.
