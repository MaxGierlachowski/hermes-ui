# 0010: A chat is done only when its own Paseo agents are done too

- **Status:** Accepted
- **Date:** 2026-11

## Context

The inbox and push notifications tell the user when a chat needs them. A Hermes turn often ends right
after Hermes started Paseo agents for the real work. Reporting "done" at that point is wrong: the work
is still running, and a second notification follows later anyway.

The board had the same problem for its columns ([ADR 0002](0002-paseo-integration-read-only.md)).

## Decision

- A Hermes chat counts as **done** (inbox entry and "Done" push) only when Hermes' turn is over **and**
  none of the Paseo agents the session started or steers is still running or waiting for a permission.
  This is the same rule that decides between Doing and Waiting on the board.
- Agents the session only watched (read calls) do not count. Archived agents do not count.
- A Paseo agent that finishes, fails or hits a usage limit is its own inbox entry and notification.
- Open requests (Hermes approvals and clarify prompts, Paseo permissions) are never stored. They are
  derived live, so the inbox cannot show a request that no longer exists. History entries record how
  each request ended: answered here, answered elsewhere, or expired.

## Consequences

- Fewer, more accurate "done" notifications.
- Board column, inbox and push agree on what "finished" means.
- If the Paseo integration is off or disconnected, the rule reduces to "Hermes' turn is over".

## Alternatives considered

- **Done at the end of every Hermes turn:** simple, but noisy and misleading with agents.
- **Done only when the user moves the card:** that is the board's Done column
  ([ADR 0007](0007-done-only-by-user.md)); notifications need an automatic signal.
