# 0012: One codebase for phone, web and desktop (spike result)

- **Status:** Proposed (spike done; the switch-over is the owner's decision)
- **Date:** 2026-11-19
- **Follows:** [ADR 0004](0004-tauri-option.md) (Tauri as an option)

## Context

Hermes UI has two clients today: the shadcn web UI (`web/`, Vite + React DOM) for the browser and the
desktop, and the Expo app for iOS and Android. Every feature is built twice. The question for this spike:
can the Expo app (`expo export -p web` through react-native-web) also be the web UI, and, wrapped in
Tauri 2, a desktop app, while feeling like a good native app? Platform-native widgets are not the
goal; behaviour, speed and details are (Linear, Things, Raycast as the bar).

## What was built

- **Platform layers** in the app (Metro picks `*.web.ts` for the web build, the plain file for iOS /
  Android). Everything above them (store, screens) is shared.

  | Concern | iOS / Android | Web / desktop |
  |---|---|---|
  | Transport | `expo-iroh` (Rust, UniFFI) | HTTP to 127.0.0.1 with the token (desktop, local), or `iroh-fetch` WASM for remote (same pairing links as the web UI) |
  | Secrets | Keychain / Keystore (`expo-secure-store`) | macOS Keychain through the Tauri shell; `localStorage` in a browser |
  | Cache | JSON files (`expo-file-system`) | IndexedDB, loaded into memory at start (same synchronous API) |
  | Media | downloaded once into the cache dir | tokenised URL (HTTP), object URL (iroh), data URL (demo) |
  | Notifications | `expo-notifications` | Tauri notification plugin; Notification API in a browser |
  | Voice / camera | `expo-audio`, `expo-camera`, image picker | `expo-audio`'s MediaRecorder path; file picker, paste, drop |
  | Haptics, keep-alive, share intent | native | no-ops |
  | Column pager | `react-native-pager-view` | CSS scroll snap |

- **Layouts by width:** phone (< 700 dp, the existing pager, unchanged), tablet or narrow window
  (700–1023: two columns side by side, snap-scrolling), desktop (≥ 1024: four columns, chat in a
  resizable split pane, search as ⌘K palette, new chat as a dialog).
- **Desktop interactions:** ⌘K / `/` search, ⌘N / `n` new chat, ⌘1–4 a column, ↑ ↓ ← → (or h j k l) in
  the board, Enter opens, Esc closes the topmost layer, ⌘B / ⌘I board / inbox, ⌘, settings; Enter sends
  (⇧Enter new line); right-click menu on cards (a real macOS menu in the desktop app); drag & drop of
  cards between columns; images by paste or drop; text selection and ⌘C in messages; desktop density
  (36 px controls) with a fine pointer, 48 dp touch targets otherwise.
- **Thread on the web:** a plain scrolling `<div>` with `flex-direction: column-reverse` (starts at the
  newest message, stays anchored there, no inverted transform) and `content-visibility: auto` per row,
  so the browser's own scrolling, selection and find work and long threads stay cheap.
- **Desktop app (`desktop-app/`, Tauri 2):** overlay title bar with the traffic lights in the header,
  native menu bar, tray with launch at login, global shortcut (⌥⇧H), single instance, window state,
  system notifications, Keychain, and the backend as a **sidecar** (bundled Node + esbuild bundle of
  `server/`, own data dir, port 8799) or a connection to a running backend. See
  [desktop-app.md](../desktop-app.md).
- **Backend:** a CORS allow-list (`tauri://localhost` and `HERMES_UI_CORS_ORIGINS`), Bearer token only.

## Measurements

`scripts/measure-ui.mjs`: both UIs in the same browser with the same generated data (41 chats, one with
450 messages of markdown, code, tables and tool calls); every API request is answered in the page (no
backend, no latency), so the numbers compare the UIs, not the network. 1440 × 900, median of 3 runs,
times from navigation start / from the click until the text is on screen (polled every frame).

| | shadcn · Chromium | universal · Chromium | shadcn · WebKit | universal · WebKit |
|---|---|---|---|---|
| Cold start to board | 107 ms | 157 ms | 124 ms | 210 ms |
| Warm start (reload) | 66 ms | 81 ms | 87 ms | 122 ms |
| Open a chat, first time | 104 ms | 118 ms | 57 ms | 99 ms |
| Open it again | 58 ms | 64 ms | 37 ms | 65 ms |
| Board → Inbox → Board | 77 ms | 95 ms | n/a¹ | 151 ms |
| Open the 450-message chat | 126 ms | 89 ms | 127 ms | 56 ms |
| Scroll it (3 s of wheel) | 60 fps, max frame 17 ms | 60 fps, max frame 33 ms | 60 fps, 18 ms | 59 fps, 49 ms |
| JS heap after the run | 33 MB | 61 MB | – | – |

¹ The shadcn inbox tab could not be driven in headless WebKit.

Before two fixes found by these measurements, the universal cold start was **431 ms** (Chromium): lazy
route chunks suspended the first render and React holds a revealed Suspense boundary back for up to
300 ms (fix: `asyncRoutes` off for the web), and Metro bundled all of `lucide-react-native` (2 MB; fix:
Expo's tree shaking for the web export).

| Size | shadcn | universal |
|---|---|---|
| Initial JS + CSS, gzip | 356 KB | 683 KB |
| All JS, gzip (incl. lazy chunks) | 2061 KB (shiki grammars) | 694 KB |
| iroh WASM (remote only, lazy) | 3.4 MB | 3.4 MB |

Real data (an isolated test backend on the same Hermes, read-only): the longest chat, a Slack thread
with 563 messages (380 rows after the backend's grouping), opened in **88 ms** (Chromium) / **85 ms**
(WebKit) and scrolled at 60 / 59 fps.

**Desktop app** (macOS, Apple silicon, release build): app 128 MB (of which the Node runtime for the
sidecar is 116 MB), DMG 41.5 MB. Memory (`footprint`) with the real board open: shell 38 MB, WebContent
133 MB, GPU 23 MB, networking 5 MB, i.e. **≈ 200 MB for the UI**, plus 148 MB for the sidecar backend
(the same as a separately running backend).

**Android** (emulator, Pixel 10 Pro image, release build, demo mode; 0.3.0 from the release vs. this
branch): no regression. Time to first frame (`am start -W`, 5 cold starts, median) 415 ms vs. 277 ms (the
spread is large on the emulator); the board renders 126–154 ms after start (the demo adds 120 ms of
simulated latency); scrolling the 450-message chat: frame time p50 17 ms, p99 20 ms. Swipe pager,
thread, back gesture, sending with a streamed reply checked by hand.

## Parity: shadcn web UI vs. universal

| Feature | Universal | Effort to close |
|---|---|---|
| Board with four columns, live updates, drag & drop between columns | ✅ (HTML5 drag & drop; no reordering inside a column, as in shadcn) | – |
| Thread: transcript, tool calls, images, streaming, stop | ✅ | – |
| Composer: text, images (paste, drop, picker), voice | ✅ | – |
| Approvals and questions (once / session / always / deny, buttons, multi-select, free text, countdown) | ✅ | – |
| Paseo chips, agent list, transcript | ✅ | – |
| Paseo deep link into the Paseo app | ❌ | S |
| `MEDIA:` attachments (images, audio) | ✅ | – |
| Inbox: open requests, history, read / unread, mark all read | ✅ | – |
| Inbox filters by kind and source, grouped by day | ❌ | S |
| Toasts, badge (dock icon, window title) | ✅ | – |
| Search: full text, ⌘K palette with commands | ✅ | – |
| Search: jump to the matching message, archived chats | ❌ | S |
| New chat | ✅ | – |
| Light / dark, English / German | ✅ | – |
| Settings: period, cron/system filter, theme | ✅ | – |
| Code highlighting in messages (shiki in shadcn) | ❌ | M |
| Web Push (browser, phone home screen) | ❌ (desktop: system notifications while the app runs) | M |
| Notification settings per device (kinds, quiet hours) | ❌ | S–M |
| Remote access dialog (pairing code + QR for another device, device list, revoke) | ❌ | M |
| URL state (`#/inbox/<chat>`, reload keeps the open chat) | partial (routes on the phone; the desktop split pane is not in the URL) | S |
| PWA install, served by the backend itself (cookie login) | ❌ (pairing link, local URL + token, or the desktop app) | S |
| Phone layout | ✅ (native pager on iOS / Android; CSS snap in a phone browser) | – |

S ≈ up to half a day, M ≈ one to two days.

## UX verdict

Where it feels native:

- **Scrolling** is the browser's own (momentum, rubber band, scrollbar) in the board and the thread;
  no RN ScrollView emulation, no inverted list.
- **Speed**: opening chats, switching tabs and long threads are as fast as the shadcn UI; long threads
  are faster (content-visibility). Cold start is 50–90 ms behind.
- **Keyboard**: everything listed above, Esc peels one layer at a time, focus rings only for keyboard
  focus.
- **Desktop chrome**: overlay title bar, real menu bar (Edit menu, so ⌘C / ⌘V / ⌘A work), native
  context menus, tray, global shortcut, Keychain, launch at login.
- **Text** in messages can be selected across messages and copied.

Where it does not (yet):

- **Markdown** goes through `react-native-marked`: no syntax highlighting, and tables and code blocks are
  plainer than in the shadcn UI.
- **Dialogs and the lightbox** have no open/close animation on the web and no focus trap; screen-reader
  semantics are thinner than Radix's.
- **Hover**: fewer hover states and no tooltips.
- **Drag & drop** uses the browser's drag image; no animated drop placement as with dnd-kit.
- **React Native Web input quirks** needed workarounds: Escape does not bubble out of a text field
  (handled in the capture phase), Chrome reserves ⌘N (`n` works in the browser, ⌘N in the desktop app).
- **Desktop shell gaps**: a click on a system notification only brings the app to the front, it does not
  open the chat; no badge on the tray icon; no Windows / Linux build yet; unsigned.

## Decision (recommendation)

**Yes, replace the shadcn web UI with the universal app, but not yet.** One codebase removes the double
work, the phone app loses nothing, and the desktop app adds what a browser tab cannot (tray, global
shortcut, Keychain, a backend in the same app). Performance is on par for everything a user does after
start-up.

Before the switch:

1. Close the parity gaps marked ❌ above: Web Push, remote-access dialog, code highlighting, inbox filters,
   search jump, Paseo deep link, PWA / same-origin serving. Rough total: one to two weeks.
2. Polish: dialog / lightbox transitions and focus trap, tooltips, notification click → chat.
3. Port the Playwright suite in `web/e2e/` (touch targets, phone behaviour, desktop screenshots) to the
   universal build; `scripts/check-universal-web.mjs` is the start.
4. Then point GitHub Pages at the universal web build and delete `web/`.

Until then: keep `web/` as the default web UI, ship the desktop app as a beta (unsigned DMG; signing and
notarization in [releasing.md](../releasing.md#desktop-app-macos)).

## Consequences

- New directory `desktop-app/` (Tauri 2, Rust). The app's web build is part of the release process.
- The backend gains `HERMES_UI_CORS_ORIGINS`; the desktop origin is always allowed (token required).
- The desktop app stores the backend token in the Keychain. Any local process can still reach the
  loopback port (as before; see [security.md](../security.md)).

## Alternatives considered

- **Electron**: the same idea with Chromium inside. Larger (≈ 100 MB more) and more memory; Tauri uses
  the system WebView, and WebKit performed as well as Chromium here.
- **Keep two UIs**: no new risk, but every feature twice.
- **Tauri 2 Mobile instead of Expo**: ruled out in [ADR 0003](0003-native-app-expo-with-native-iroh.md)
  (WebView UI on phones).
