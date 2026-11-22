# Labels — design decisions

Each call with a one-line rationale. Scope: labels on board cards (managed set, multi-label, filter).

1. **Storage: `board.data.labels` + `board.data.cardLabels` in `data/board.json`.** Labels are board state like
   column overrides and test markers, which already live there (`src/board.mjs`); no new store, and the backend
   never writes under `$HERMES_HOME` (README promise).
2. **Shape: `labels = [{ id, name, color }]` (array = display order), `cardLabels = { cardId: [labelId] }`.**
   Stable random ids make rename/recolor free (no rewrite of assignments); the per-card map mirrors `overrides`.
3. **Cards carry `labels: string[]` (ids), the list is separate (`/api/labels`, also in `GET /api/sessions`).**
   One source of truth for name/color; a rename updates every card without re-sending them.
4. **Delete cascades server-side** and the API answers with the touched card ids; `forCard()` also drops any id
   not in the list. No orphan references can reach the UI, even from a hand-edited `board.json`.
5. **Names: trimmed, max 40 chars, unique case-insensitively (409 on clash).** Two "MOUVE"/"mouve" labels would
   make the filter ambiguous.
6. **Colors: `#rrggbb`, 10 presets (Tailwind 500 tones) + the system color picker for anything else; a new label
   without a color gets the next preset in turn.** GitHub-like freedom, but sensible defaults so three quick labels
   are already distinguishable. Hex (not class names) so the native app can render them too.
7. **Chip look: colored dot + name in the normal text color on a ~12 % tint of the label color.** Readable in light
   and dark mode for any user-picked color without contrast math.
8. **Filter semantics: OR within labels ("cards with any of the selected labels"), AND with search and source.**
   The request is "focus on personal *or* mouve cards"; cards usually carry one project label, so AND would mostly
   yield an empty board. The existing filters (search, source, cron/system) narrow each other, so label vs. other
   filters stays AND.
9. **Filter UI: a chip bar above the board (desktop) / above the column tabs (phone), shown only once a label
   exists.** One control that works for mouse and thumb (44 px on touch); the header has no room on phones (the
   source filter is hidden there). Also reachable in ⌘K ("Filter by label: …").
10. **The selected filter is kept per device (`localStorage hk_label_filter`), not on the server.** Same as the
    other view settings (days, cron/system); a phone can focus on "Privat" while the desktop shows everything.
    Ids of deleted labels are dropped from it automatically.
11. **Label picker on the card lives in the thread header (tag button): popover on desktop, bottom sheet on
    phones.** The header already holds the card's other settings (column); on the board, click opens the thread and
    long-press moves the card, so there is no free gesture for labels there. Toggles apply immediately, optimistic.
12. **Management: one dialog (bottom sheet on phones) from ⌘K "Manage labels …", the ⚙ in the filter bar and the
    picker's "Manage labels …".** Inline rename (Enter/blur saves, Esc reverts), swatch for recolor, trash for
    delete with a confirm only when cards still carry the label.
13. **Nothing visible changes until the first label exists** (no filter bar, no tag button). Unlabeled boards stay
    pixel-identical, which keeps the desktop regression baselines valid, and labels stay strictly optional.
14. **Live sync over the existing SSE stream:** `labels` (full list, on every change and on connect) and the usual
    `session` event for each card whose labels changed. Every open client (phone + desktop) updates without reload;
    older clients ignore the unknown event.
15. **A draft that gets started keeps its labels** (moved to the new session id); a discarded draft's labels are
    removed. A draft is a card like any other.
16. **Routes live in `src/labels.mjs` (`labelRoutes()`), mounted by `server.mjs` after auth.** Keeps the 1200-line
    server from growing and lets `test/labels.test.mjs` run the real routes on a real `http.createServer` with a
    real `Board`, without Hermes' `state.db`.
17. **No hard limit beyond 100 labels, no hierarchy, no permissions** — single-user personal software (per request).
