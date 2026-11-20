# Changelog

All notable changes. The backend + web UI and the app share one repository; app releases are tagged
`app-vX.Y.Z` (version and build number in `app/version.json`; up to 0.3.0: `mobile-app-vX.Y.Z`).

## Unreleased – universal spike

### App: Summary pill visible on phones, even tab padding (app 0.5.3)
- Fixed: on Android (and iOS with a home indicator) the Summary pill was hidden behind the composer;
  only its top edge showed. It hung out of the composer box with `bottom: '100%'`, and on native a
  percentage inset ignores the box's safe-area padding, so the pill sank by that inset and the
  composer drawn after it covered it. The pill now floats at the bottom of the message list, inside
  its box (`ThreadPane.tsx`, `SummaryPill.tsx`); visible and tappable with and without the keyboard.
- Fixed: on the phone board the active column tab's pill touched the line below the tabs. It had a
  fixed 48 dp height and 6 dp offset while the tabs, styled with NativeWind (rem = 14 on native), are
  42 dp high with 5.25 dp padding. The pill now fills the tab row, so the gap is the same above and
  below. The sync progress line (`SyncBar`) no longer takes height of its own; it lies over the edge
  below the header instead of pushing the tabs down by 1.75 dp.
- Demo mode: `/demo?board=<n>` adds n finished chats in Done (performance measurements, like `?long=`).

### Desktop app: external links open in the default browser (app 0.5.2)
- Fixed: in the desktop app a click on a link did nothing (copy via the context menu worked). WKWebView
  drops `target=_blank` and `window.open`, and the opener permission had no URL scope. Links now go to
  the default browser (`mailto:` to the mail app), through a Rust command limited to `http(s)` and
  `mailto:`; a navigation guard and a new-window handler catch anything else, so no link can replace
  the app in its window. `javascript:`, `file:`, `data:` and custom schemes are dropped. Details in
  [desktop-app.md](docs/desktop-app.md#links).
- Same entry point (`openExternal`) for the app on phones and the web build; tests for the URL rules in
  `server/test/links.test.mjs` and `cargo test` (`src-tauri/src/external.rs`).

### Board: newest chats first, older ones page in while scrolling (app 0.5.1)
- Fixed: with Cron/System hidden the board could miss chats from yesterday. The backend loaded the 400
  newest sessions of the last days and only then dropped cron runs in JavaScript; with ~85 cron runs an
  hour, a chat from the day before ranked beyond 1,000. The filter now runs in SQL before the limit.
- `GET /api/sessions` is paginated: `limit`, `before=<ts>:<id>` cursor, `nextCursor` in the answer
  (see [architecture.md](docs/architecture.md#backend-and-hermes)). Drafts and pinned cards come with the
  first page only. Old clients without `limit` keep working (`days` still accepted, 200 cards).
- App and web UI: scrolling to the end of a column loads the next older page; a short column shows
  "Load older chats". Live refreshes merge by id and keep the pages already loaded.
- The time-window setting defaults to "All" (newest chats, no window); 1/3/7/30 days stay available.
  The old saved value is not carried over, so a former default of 3 days does not stick as a filter.

### Hermes' own agents next to Paseo agents (ADR 0013)
- `delegate_task` subagents and terminal runs of `hermes [-p <profile>] chat -q …` show up like Paseo agents:
  inline where they were started, in the chat's agent list with state and read-only transcript, as chips
  on the card, and the chat stays in Doing while one runs ("Agents running (n)"). Backend, app and web UI.
- Subagents are matched by Hermes' ids; terminal runs by prompt or start time, labelled as heuristic.

### Summary pill above the composer
- A floating "Summary" pill above a chat's composer sends one fixed prompt (in `shared/summary.ts`) as a
  normal message: Hermes summarizes the chat, explains the state and lists every open task (what, who,
  blocked by), in the chat's language. Hidden while the chat is empty, a turn runs or an approval waits;
  feedback after the click, no double send. App and web UI.

### Image viewer on the desktop
- Fixed: in the desktop app (and the app's web build) a click on an image opened a transparent overlay
  with only the X. NativeWind does not style reanimated's `Animated.View` on react-native-web, so the
  viewer had no height and no backdrop; its layout and colours are now plain styles. The image shows at
  its own size on a dark backdrop, with a loading spinner and an error state (file path, link for web
  URLs); closes with X, Esc or a click beside the image. The web UI's viewer was not affected.
- Same cause, also fixed: on the app's web build the bottom sheet (narrow window / phone browser) had no
  backdrop and no background, the sync progress bar and the pulsing status ring did not show.

### Voice messages on the desktop
- Fixed: in the desktop app nothing happened after recording and pressing send. The CSP refused
  `fetch(blob:)` and the error was swallowed. The recording now stays a Blob (no fetch), the CSP allows
  `blob:` / `data:`, and every failure is shown; an undelivered recording is kept with "send again".
- While a voice message is transcribed, the composer shows a progress state (app and web UI); the
  backend reports a failed transcription to the client.

### Renamed: `mobile-app/` → `app/`
- The app is no longer only the mobile app, so its folder is `app/` (package `@hermes-ui/app`). App id,
  bundle id and signing are unchanged. Release tags: `app-vX.Y.Z`.
- **Migration** (once, in the checkout with the keystore): move `mobile-app/.secrets` and `mobile-app/.env`
  into `app/` and fix `storeFile` in `keystore.properties`; commands and a signature check in
  [docs/secrets-and-state.md](docs/secrets-and-state.md#after-the-rename-of-mobile-app-to-app-2026-11).
  Old secrets backups restore into `app/` automatically.

### App: one codebase for phone, web and desktop (spike, ADR 0012)
- The app also builds for the web (react-native-web): platform layers for transport (local HTTP or
  iroh-fetch WASM), Keychain / localStorage, IndexedDB cache, notifications, media, voice.
- Wide layouts: two columns on tablets, four columns + resizable chat pane on desktops; ⌘K palette,
  keyboard navigation, drag & drop between columns, right-click menus, Enter to send, desktop density.
- Web cold start 431 → 157 ms (one bundle, tree shaking); measurements in `scripts/measure-ui.mjs`.
- Fixed: Esc in the lightbox no longer also closes the chat; tablet columns keep their width.

### UI polish to the web UI's look (`desktop-spike-3`, app `0.4.0-beta`)
- Design system aligned with the shadcn web UI: Geist on web and desktop, its radius and shadow scales
  (soft box shadows instead of 35 % RN shadows), focus rings for the keyboard only, tooltips on icon
  buttons, fade/zoom for dialogs, palette and menus; buttons, inputs, Kbd and Switch in shadcn sizes on
  the desktop, touch sizes (≥ 44 px) on phones.
- Board cards, columns and header at the web UI's density (2-line titles); the ⌘K palette with groups,
  recent chats, match highlights, a meta line and key hints; the new-chat dialog with title and
  "only create"; the composer as one prompt box (desktop) / one-line pill (phone).
- Inbox like the web UI: filters, item cards with a header, uniform small buttons, history by day.
- Thread: header with a meta line, timestamps on hover, short threads start at the top; code blocks with
  syntax highlighting (Prism, GitHub colours, loaded on demand), inline code, lists, links, tables.
- Phone: header with logo, column tabs as a pill with status dots, opening in "Waiting".
- No performance regression against the spike (`scripts/measure-ui.mjs`); findings and deliberate
  deviations in [docs/ui-audit.md](docs/ui-audit.md).

### Desktop app: permissions (`desktop-spike-2`)
- macOS now asks for the microphone, the camera and notifications (usage texts in `Info.plist`,
  hardened-runtime entitlements, notifications through `UNUserNotificationCenter`); a click on a
  notification opens its chat. A refused permission shows "Open System Settings".
- Camera in the desktop composer (live preview, the photo becomes an attachment).
- Stable ad-hoc signature (`scripts/sign-adhoc.sh`): permission decisions survive rebuilds.
- Keychain entries per bundle identifier; Keychain calls no longer block the window.
- Board: the top card's selected / open / focus ring is drawn inside the card (was cut off).
- Toasts redesigned in the web UI's sonner style (soft shadow / dark border, stacking, hover to
  spread and close), one component for phone, web and desktop.

### Desktop app (new, `desktop-app/`, unsigned spike)
- Tauri 2 shell for macOS: overlay title bar, menu bar, tray, launch at login, global shortcut,
  Keychain, notifications, the backend as a built-in sidecar or a connection to a running one.

### Backend
- `HERMES_UI_CORS_ORIGINS`: CORS for the desktop app (`tauri://localhost`, always) and listed origins,
  Bearer token only.

## 0.3.0 – 2026-11-19

### Mobile app (0.3.0, build 3)
- **Demo mode**: "Try the demo" on the pairing screen shows the app with sample data and streamed replies,
  no backend needed (for a first look and for app review). Also `hermesui://demo`.
- **Store readiness**: app identity (name, app id, scheme, link hosts, Apple team, EAS project) from
  `mobile-app/.env`; one version source (`version.json`); `eas.json` profiles; `npm run release:android`
  builds the Play bundle (AAB) and one APK per ABI; iOS privacy manifest, usage texts, local-network text,
  export-compliance flag; target SDK 36.
- Background keep-alive is a `dataSync` foreground service (stops itself at Android 15's time limit; the
  type is a build setting).
- Removed permissions nobody used: background media playback, biometrics (Android), background audio and
  Face ID (iOS).

### Web UI
- Fixed: a long word or URL in the new-chat dialog pushed the composer past the dialog's edge.

### Repository
- Monorepo with npm workspaces: backend in `server/`, `web/`, `shared/`; `mobile-app/` stays separate.
  `node bin/hermes-ui.mjs serve` keeps working from the repo root.
- `scripts/bootstrap.sh` (fresh machine in one command), `scripts/export-secrets.sh` /
  `import-secrets.sh` (encrypted backup of keys and state), `hermes-ui install-gateway`.
- Docs in `docs/` (architecture, security, self-hosting, development, mobile app, releasing, secrets,
  design, decisions); store texts, review notes and graphics in `store/`; privacy and support pages in
  `site/`; CI for backend, web, app and Rust; Android release workflow.

## 0.2.0 – 2026-11-19
- Mobile app: board as a swipe pager, faster transitions, offline cache (board, inbox, threads, media).
- `mobile/` renamed to `mobile-app/`.

## 0.1.0 – 2026-11-18
- Native app (Expo) with a native iroh client (Rust via UniFFI); FCM push sender next to Web Push.
- Web UI: tabs, inbox across all chats, Web Push, full-text search, Paseo agents via paseo-mcp events,
  assistant attachments (`MEDIA:`), touch-sized controls, sheets, pinch-zoom image viewer.
- Headless backend + standalone UI with remote access over iroh; GitHub Pages build.
