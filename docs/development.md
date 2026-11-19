# Development

From a fresh clone to a running setup on a new Mac. Related: [architecture.md](architecture.md) ·
[app.md](app.md) · [secrets-and-state.md](secrets-and-state.md) · [releasing.md](releasing.md).

## One command

```bash
git clone https://github.com/MaxGierlachowski/hermes-ui.git && cd hermes-ui
scripts/bootstrap.sh                 # backend + web: Node check, npm ci, iroh-gateway, checks, tests, build
scripts/bootstrap.sh --mobile        # + app toolchain and the native iroh library (Android, iOS)
scripts/bootstrap.sh --mobile --yes  # install missing tools without asking (Homebrew, sdkmanager, rustup)
scripts/bootstrap.sh --start         # afterwards: backend, web dev server, app dev server
```

Or with make: `make setup`, `make setup-mobile`, `make start`, `make verify` (see `Makefile`).

Moving from another machine? Restore the secrets and state first ([secrets-and-state.md](secrets-and-state.md)):
`scripts/import-secrets.sh ~/hermes-ui-secrets-….tar.gz.age`. Then the backend keeps its iroh identity
and every paired device keeps working.

## Versions

Pinned in the repo; `bootstrap.sh` checks or installs them.

| Tool | Version | Pinned in | Install |
|---|---|---|---|
| Node.js | 24.20.0 (≥ 24 works) | `.nvmrc`, `.node-version`, `mise.toml` | mise, nvm or fnm |
| npm | the one bundled with Node 24 (11.x) | — | — |
| JDK | 17 (Temurin) | `mise.toml`, `Brewfile` | `brew install --cask temurin@17` |
| Android SDK | platform 37 (compileSdk), build-tools 37.0.0, platform-tools | `scripts/bootstrap.sh` | Android Studio or `brew install --cask android-commandlinetools` |
| Android NDK | 27.1.12297006 (React Native) and 28.2.13676358 (iroh library) | `scripts/bootstrap.sh` | `sdkmanager "ndk;…"` |
| Rust | 1.100.0, targets `aarch64-linux-android`, `x86_64-linux-android`, `aarch64-apple-ios`, `aarch64-apple-ios-sim` | `app/modules/expo-iroh/rust/rust-toolchain.toml` | rustup (`brew install rustup`); installs the pin on first use |
| cargo-ndk | 4.1.2 | `scripts/bootstrap.sh` | `cargo install cargo-ndk --locked` |
| uniffi-bindgen | from the crate itself (`--features bindgen`) | `Cargo.lock` | nothing to install |
| Xcode | 26 or later (App Store uploads need the iOS 26 SDK) | — | App Store |
| CocoaPods | 1.17 | `Brewfile` | `brew install cocoapods` |
| Watchman | any (optional, faster Metro) | `Brewfile` | `brew install watchman` |
| age | any (encrypted backups) | `Brewfile` | `brew install age` |

`brew bundle` installs everything in the `Brewfile`. Use rustup's `cargo` (`~/.cargo/bin` first on
`PATH`): Homebrew's `cargo` has no Android or iOS targets.

## Layout

```
server/       backend + CLI (Node, no build step); package "hermes-ui"
web/          React UI (Vite); built to web/dist, served by the backend or any static host
shared/       TypeScript shared by web and app (types, SSE parser, pairing links, texts)
app/   Expo app + native iroh module (own lockfile, not an npm workspace)
docs/         this manual            store/   listing texts, review notes, graphics, screenshots
site/         static pages next to the UI on GitHub Pages (privacy, support)
scripts/      bootstrap, secrets backup        bin/   `node bin/hermes-ui.mjs` entry point
data/, .env   local state and secrets (git-ignored; docs/secrets-and-state.md)
```

npm workspaces (`server`, `web`, `shared`) share one `package-lock.json` at the root. `app/` keeps
its own: Expo pins React / React Native exactly and its native autolinking expects its own tree.

## Everyday commands

```bash
npm start                 # build the UI, start the backend on http://127.0.0.1:8787
npm run dev               # Vite dev server on :5173, proxies /api to the backend
npm run verify            # backend syntax check + unit tests, typecheck web + app, web build
npm run test:ui           # Playwright UI tests (phones + desktop pixel baselines; macOS fonts)
npm run lint              # oxlint (web)
cd app && npx expo run:android   # dev client on an emulator / phone
cd app && npm run web            # the same app in the browser (Expo web, :8081)
cd app && npm run web:export     # static web build → app/dist-web
cd desktop-app && npm ci && npm run build   # macOS desktop app (.app + .dmg), see desktop-app.md
node scripts/measure-ui.mjs             # shadcn vs universal web build, same data (serve both first)
node scripts/check-universal-web.mjs    # desktop-layout interaction check (dist-web on :8811)
```

Run a second backend next to one that is already running (e.g. your daily one on 8787):

```bash
HERMES_UI_PORT=8797 HERMES_UI_DATA_DIR=/tmp/hermes-ui-dev HERMES_UI_REMOTE=iroh node bin/hermes-ui.mjs serve
```

It gets its own token, iroh identity and devices in that data dir.

## Tests

- `npm test`: backend unit tests (`server/test/`, `node --test`).
- `npm run test:ui`: the built UI with every `/api` request answered from fixtures (`web/e2e/`); touch
  targets, mobile gestures, long-text overflow, desktop pixel comparison. Once per machine:
  `npx playwright install chromium` in `web/`.
- `npm --prefix app run typecheck`; `npm --prefix app run iroh:test` pairs the Rust client
  with a running backend (see [app.md](app.md#tests)).
- CI (`.github/workflows/ci.yml`) runs all of these without secrets.

## Conventions

English in code, comments and docs; the UI is English and German (German source strings, English in
`shared/i18n-en.ts`). Conventional commit messages (`feat(app): …`). No personal data, company
names or real chat content in fixtures, tests or screenshots. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## UI tests in detail

The UI tests run the built bundle with every `/api` request answered from synthetic fixtures (`web/e2e/fixtures.ts`), so they need no backend and never touch Hermes. They cover three phones (390 × 844, 375 × 667, 412 × 915, touch) and a desktop:

- `touch-targets`: every interactive element on every screen must be hittable over 44 × 44 px (measured by hit-testing, so an enlarged hit area counts and an overlapping neighbour fails), and no field may be below 16 px.
- `mobile-behaviour`: sheet swipe-to-close, long-press, column swipe, Enter in the composer, the keyboard inset, and the image viewer (pinch, double tap, swipe down; the page scale must stay 1).
- `desktop-regression`: pixel comparison at 1440 × 900, light and dark, against `web/e2e/__screenshots__/`. Touch styles live behind `pointer: coarse` (Tailwind variant `touch:`) or `max-md:`, so a desktop with a mouse must not change by a single pixel. After an intended desktop change, update the images with `npx playwright test desktop --update-snapshots` (in `web/`) and review them. The images are rendered on macOS; other systems render fonts differently.
- `SHOTS_DIR=<dir> npx playwright test screenshots` writes one screenshot per screen, phone and theme.

Once per machine: `npx playwright install chromium` in `web/`.
