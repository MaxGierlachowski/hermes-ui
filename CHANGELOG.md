# Changelog

All notable changes. The backend + web UI and the mobile app share one repository; mobile releases are
tagged `mobile-app-vX.Y.Z` (version and build number in `mobile-app/version.json`).

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
