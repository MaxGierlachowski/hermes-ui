# Changelog

All notable changes. The backend + web UI and the app share one repository; app releases are tagged
`app-vX.Y.Z` (version and build number in `app/version.json`; up to 0.3.0: `mobile-app-vX.Y.Z`).

## Unreleased – universal spike

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
