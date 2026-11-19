# 0002: Paseo integration is read-only

- **Status:** Accepted
- **Date:** 2026-11

## Context

Hermes often starts and manages [Paseo](https://paseo.sh) coding agents through paseo-mcp. Then a
Hermes chat is "finished" while its agents still work, and a card in Waiting would be wrong. Users
want to see those agents on the card, their status and their transcripts.

Paseo agents carry no Hermes session id. The only link is Hermes' own transcript: the `paseo_*` tool
calls a session made. Writing to Paseo from a second UI would compete with Hermes, which is the
orchestrator.

## Decision

- Derive which agents belong to a session from Hermes' transcript in `state.db`: `created` (the
  session started it), `steers` (sent messages, answered permissions, archived it) and `watches`
  (only read it). Only `created` and `steers` affect the column.
- Read agent state from paseo-mcp (≥ 0.4.0) through a resource subscription, with the stdio client
  started as `PASEO_MCP_READONLY=1`. Fall back to a direct, read-only daemon connection
  (`HERMES_UI_PASEO_SOURCE=auto|mcp|daemon`).
- Show transcripts read-only: no input field, no buttons that change an agent. A deep link opens the
  agent in the Paseo app.
- **One exception:** answering a pending Paseo permission from the inbox. It goes through paseo-mcp's
  own `paseo_respond_permission` tool on a second, short-lived client, is logged, and can be turned
  off with `HERMES_UI_PASEO_RESPOND=off`.
- The integration is optional (`HERMES_UI_PASEO=off`). Without Paseo it stays silent.

## Consequences

- A session whose own agents still run stays in Doing ("Paseo running (n)"). An agent waiting for a
  permission moves the card to Waiting with a note.
- Hermes stays in charge of its agents; the board cannot start, steer or archive them.
- The mapping is a heuristic over tool calls. It recognises direct calls and calls through Hermes'
  `tool_call` wrapper, and resolves short id prefixes against known agents.
- Answering permissions is a deliberate write path. Operators who want a strictly read-only board
  switch it off.

## Alternatives considered

- **Full control from the board** (send messages, archive): rejected; two controllers for one agent
  invite conflicts, and Hermes already offers this through chat.
- **Polling the daemon only:** worked, but paseo-mcp events avoid polling and reuse the access path
  Hermes already has. The daemon stays as fallback and for richer transcripts.
- **Labels on Paseo agents to store the session id:** would need changes in Paseo or paseo-mcp.
