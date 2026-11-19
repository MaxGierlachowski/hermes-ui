# 0006: Talk to Hermes through the gateway WebSocket, read state.db read-only

- **Status:** Accepted
- **Date:** 2026-11

## Context

The board must show every Hermes session (desktop app, chat platforms, CLI, cron, webhooks), update
live, and let the user continue any of them, including images and voice. The backend must not change
Hermes' configuration and must never restart the gateway, because that would kill running chats and
scheduled jobs.

Ways to reach Hermes that were checked:

- **The API server platform** (OpenAI-compatible endpoints): disabled by default, enabling it needs a
  config change and a gateway restart, it cannot continue sessions that belong to other surfaces
  (it answers 409), and it does not take audio.
- **The gateway WebSocket** used by the Hermes desktop app: already running, JSON-RPC 2.0, works for
  every session, and needs no configuration change. Tickets come from the local control socket, which
  checks the Unix user. The gateway refuses connections with an `Origin` header, so browsers cannot
  connect directly.
- **`hermes chat -r <id> -q …`:** one process per turn and no streaming.
- **The session database `state.db`:** fast, complete, includes titles, prompts and tool rows.

## Decision

- **Read** sessions and transcripts from `$HERMES_HOME/state.db`, opened read-only, polled every 1.5 s
  with a watermark. Use Hermes' FTS5 index for search.
- **Write** only through the gateway WebSocket, as the desktop app does: `session.create`,
  `prompt.submit`, `session.resume`, `session.interrupt`, `approval.respond`, `clarify.respond`; image
  upload and speech-to-text through the gateway's REST endpoints with single-use tickets.
- The backend is the necessary local relay between browsers and the gateway.

## Consequences

- Every session is visible within about 1.5 s, whatever surface started it.
- Replies stream live; approvals and clarify prompts can be answered on the board.
- The backend depends on internal, undocumented protocol details of Hermes (control socket verbs,
  JSON-RPC methods, the `state.db` schema). A Hermes update can break it; parsing is defensive and
  checked against real data.
- Writing nothing to `$HERMES_HOME` keeps Hermes the single source of truth. Board-only state (manual
  columns, drafts, outbox) lives in the backend's own `data/board.json`.

## Alternatives considered

See the list above. The API server and the CLI were rejected; `state.db` alone cannot write.
