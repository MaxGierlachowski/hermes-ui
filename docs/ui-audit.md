# UI audit: universal app vs. the shadcn web UI

Goal: the universal app (`app/`, phone, web and desktop from one codebase) looks at least as good as the
shadcn web UI (`web/`), the reference for tokens, density and hierarchy. Desktop is compact like shadcn,
phones keep touch sizes.

Related: [design.md](design.md) · [mobile-audit.md](mobile-audit.md) ·
[decisions/0012-universal-app.md](decisions/0012-universal-app.md) (measurements).

## How

```bash
npm -w web run build && npm --prefix app run web:export
node scripts/ui-compare.mjs --out /tmp/ui-compare            # both UIs, same demo data, side by side
node scripts/measure-ui.mjs --runs 5 [--engine webkit]       # performance, both UIs
```

`ui-compare.mjs` bundles the app's demo backend (`app/src/lib/demo.ts`) and answers `/api` for both UIs
from it, so titles, messages, prompts and timestamps are identical. Screens: board (+ empty, error),
thread (+ top), clarify, markdown, inbox, ⌘K search, new chat, context menu, tooltip; viewports desktop
1440 × 900, tablet 1024, phone 390 (DPR 2, touch); light and dark. On phone screens it lists every
control smaller than 44 × 44 px.

The first pass (2026-11-19) measured computed styles in Chromium and found 61 differences; the 25 that
mattered most are below with their state.

## Findings and state

| # | Finding (before) | State |
|---|---|---|
| 1 | System font instead of Geist | Fixed: Geist Variable on web and desktop (`web:font-sans`), native keeps the system font |
| 2 | Inline code italic, weight 300, no chip | Fixed: mono, muted chip, radius |
| 3 | Code blocks without highlighting | Fixed: Prism with GitHub light/dark colours, loaded on demand (`lib/highlight.ts`) |
| 4 | Prose 15/22, text bullets without indent | Fixed: 14/24 on desktop, list markers with a hanging indent, links underlined (not italic) |
| 5 | Board cards 7–19 px taller (15 px titles, radius 12) | Fixed: 13 px titles on 2 lines, padding 10/12, radius 8, hover border |
| 6 | Clarify choices full-width on desktop | Fixed: one row of small buttons |
| 7 | Inbox buttons in four sizes | Fixed: one size (`sm`, 28 px desktop / 44 px phone) |
| 8 | Inbox items without a card | Fixed: card with avatar, title, source, time, "Open in thread" |
| 9 | Phone composer 135 px tall | Fixed: one-line pill (attach · field · camera / mic / send), grows with the text |
| 10 | Shadows at 35 % opacity everywhere | Fixed: the web UI's shadow scale as `box-shadow` (`lib/shadow.ts`), 1 px ring on dialogs |
| 11 | Tailwind v3 radius scale | Fixed: the shadcn v4 scale (`tailwind.config.js`) |
| 12 | Desktop composer: textarea + separate toolbar | Fixed: one prompt box with the actions inside, focus ring on the box |
| 13 | Thread header without meta | Fixed: title + meta line (source, date, cwd) |
| 14 | Short threads anchored at the bottom | Fixed: they start at the top |
| 15 | ⌘K palette: heavy shadow, no blur, no animation | Fixed: popover surface, ring, black/10 + blur overlay, fade/zoom |
| 16 | Search results flat, no highlight | Fixed: groups, match highlights, meta line, recent chats, key hints |
| 17 | New-chat dialog without title / "only create", top-anchored | Fixed: title, "only create", centred, animated |
| 18 | No tooltips | Fixed: tooltips for icon buttons (`lib/tooltip.web.ts`, `data-tip`) |
| 19 | No card hover | Fixed |
| 20 | Header and segment control too tall, harsh dark tab | Fixed: 48 px header, shadcn segment |
| 21 | Column header and padding | Fixed |
| 22 | Error state at desktop width used the phone shell | Fixed |
| 23 | Phone board: no logo, underline tabs, opens "Doing" | Fixed: logo, pill tabs with status dots, opens "Waiting" (attention first) |
| 24 | Inbox filter toolbar missing | Fixed: All / Approvals / Done / Error, source filter, mark all read |
| 25 | Low: kbd chip, date format, image width, menu shadow, toast radius | Fixed, except the date format (follows the device locale) |
| – | Phone controls under 44 px (inbox filter, small buttons, "Skip", Paseo button) | Fixed: touch `sm` / `icon-sm` are 44 px |

## Deliberate deviations from the web UI

- **Desktop header**: no source filter, 3-day range, Cron/system switch or theme toggle. The app has
  settings (gear) and follows the system theme; filters are a product decision, not polish.
- **Thread on phones**: a full-screen page with a back button (native navigation, swipe back), not the
  web UI's bottom sheet; the column is changed with the icon button in its header.
- **Thread header on desktop**: column and Paseo as icon buttons with tooltips, not a labelled select
  and Chat/Paseo tabs.
- **Hover timestamps** appear without the 150 ms fade: wheel-scrolling moves rows under a resting
  pointer, and the transitions cost a 50 ms frame.
- **Code highlighting** with Prism (GitHub colours), not shiki: shiki needs WASM / a large bundle, Prism
  renders as nested `Text` on every platform. A block shows plain text until the highlighter has loaded
  (first code block, or 3 s after start).
- **Context menu on desktop** and **error card**: the app has them, the web UI does not.
- **Phone touch sizes** stay larger than the web UI's (44–48 px), as in the mobile audit.
- **Dark board columns** keep the slightly darker surface (more contrast for the cards).

## Performance (no regression)

`scripts/measure-ui.mjs`, median of 5 runs (9 for "open a chat"), 1440 × 900, both tabs clicked with a
DOM click (Playwright's `click()` adds ~70 ms of actionability waits; before 2026-11-19 the universal
numbers in ADR 0012 included them for the tab switch). Spike = `e7c11f1`, after = this polish.

| | Chromium spike | Chromium after | WebKit spike | WebKit after |
|---|---|---|---|---|
| Cold start to board | 138 ms | 140 ms | 157 ms | 145 ms |
| Warm start | 65 ms | 66 ms | 78 ms | 76 ms |
| Open a chat, first time | 72 ms | 66 ms | 82 ms | 94 ms |
| Open it again | 30 ms | 28 ms | 31 ms | 38 ms |
| Board → Inbox → Board | 48 ms | 39 ms | 76 ms | 69 ms |
| Open the 450-message chat | 40 ms | 44 ms | 39 ms | 42 ms |
| Scroll it (3 s of wheel) | 59 fps, max frame 33 ms | 58 fps, 33 ms | 59 fps, 46 ms | 59 fps, 50 ms |
| JS heap | 69 MB | 73 MB | – | – |
| Start bundle (gzip) | 694 KB | 704 KB | | |

What it took: Prism out of the start bundle (with a static import the WebKit cold start was 176 ms),
date formatters created once, the inbox kept mounted after its first visit, no hover transitions in the
thread. WebKit's first chat opening is ~12 ms slower: the richer thread (header meta, composer box), not
the highlighter (same with a static import).
