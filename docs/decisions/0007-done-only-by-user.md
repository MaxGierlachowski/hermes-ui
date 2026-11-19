# 0007: Only the user moves interactive chats to Done

- **Status:** Accepted
- **Date:** 2026-11

## Context

The first version moved a card to Done after 24 hours without activity. In practice "inactive" does
not mean "finished": a chat may wait days for a decision, and a card that disappears into Done is easy
to forget. Only the user knows when a task is really done.

## Decision

- Interactive sessions never go to Done by themselves. There is no idle timeout.
- The user moves a card to Done by drag and drop (desktop), long-press or the column sheet (touch), or
  the column control in the thread.
- The Done marker is stored in `data/board.json` with the id of the last user message. It sticks
  until the user writes in that session again, or a turn starts after the move. Writing from the board
  clears it at once and the card goes to Doing.
- **Exception:** cron, webhook and one-shot runs have nobody to answer. When they finish they go to
  Done automatically and are visible only with the "Cron/system" filter.

## Consequences

- Waiting may hold many cards; that is intended, it is the "your turn" list.
- Done is a deliberate act and survives reloads and restarts.
- Archived sessions are hidden from the board (search can include them).

## Alternatives considered

- **Auto-Done after N hours of inactivity:** removed, together with its setting.
- **Done when Hermes says so:** Hermes has no such signal for interactive chats.
