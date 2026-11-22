# Hermes UI

**Website:** <https://maxgierlachowski.github.io/hermes-ui/> · **Web app:** <https://maxgierlachowski.github.io/hermes-ui/app/>

A Kanban board for [Hermes Agent](https://hermes-agent.nousresearch.com) sessions. Every chat (desktop, Slack, cron, CLI, or one started from the board) is a card. Cards move between **New Task → Doing → Waiting → Done** live.

On the board you can:

- start and continue chats with text, images and voice messages,
- answer Hermes' approval and clarify prompts on the card,
- see the [Paseo](https://paseo.sh) coding agents a session started, with read-only transcripts.

It has two parts:

- a **headless backend** (`hermes-ui serve`), which binds to `127.0.0.1` only;
- a **standalone UI**, a static PWA without any data or secrets. The backend can serve the UI itself, or you host it anywhere (GitHub Pages, any static host) and it reaches your backend over **iroh**: end-to-end encrypted, no open port, no account.

```
 Phone / iPad / any browser                        your machine (behind NAT)
┌──────────────────────────┐                     ┌──────────────────────────────────────────────┐
│ UI (static PWA)          │     iroh relay      │ iroh-gateway ──HTTP──▶ hermes-ui backend │
│  iroh-fetch (WASM): API, │ ◀── E2E QUIC ─────▶ │  (child process,       127.0.0.1:8787        │
│  SSE, uploads, images    │   (n0 or your own)  │   allow-list of        │  │  │               │
└──────────────────────────┘                     │   paired devices)      │  │  └─ Paseo daemon  │
                                                 │                        │  │     (optional,    │
 Local browser ─────────── http://127.0.0.1:8787 ─────────────────────────▶│  │      read-only)   │
                                                 │                        │  └─ Hermes gateway WS │
                                                 │                        └──── ~/.hermes/state.db│
                                                 └──────────────────────────────────────────────┘
```

## Quick start

```bash
git clone https://github.com/MaxGierlachowski/hermes-ui.git && cd hermes-ui
npm install          # also installs the UI (web/)
npm start            # builds the UI, starts the backend on http://127.0.0.1:8787
```

The first start writes `HERMES_UI_TOKEN` to `.env`. Open <http://127.0.0.1:8787/> and sign in with it once; an HttpOnly cookie keeps you signed in.

Requirements:

- Node.js 24 or newer.
- A running Hermes gateway. The desktop app starts one; otherwise run `hermes gateway run`.
- Optional: a Paseo daemon.

### Use it from a phone or tablet (iroh, recommended)

1. Use the hosted UI at <https://maxgierlachowski.github.io/hermes-ui/app/> (built from this repo by `.github/workflows/pages.yml`; the site root is the landing page; it never redirects, pairing links that still point there get a "Continue pairing in the app" button), or host `web/dist` yourself on any static host. It works from any path. Set its URL as `HERMES_UI_URL`.
2. Start the backend with `--remote iroh` (or `HERMES_UI_REMOTE=iroh`). On first start it downloads `iroh-gateway` for your platform from the [iroh-bridge releases](https://github.com/irohkit/iroh-bridge/releases) and verifies its SHA-256. Alternatively set `IROH_GATEWAY_BIN`.
3. Pair the device:
   - Run `hermes-ui pair`, or open the remote-access dialog (📱) on the host and press "Pair device".
   - Scan the QR code. The link carries the gateway's endpoint id and a one-time code, both in the `#fragment`, which no web server sees.
4. The browser keeps a stable iroh identity. From then on the gateway only admits paired devices: everyone else is refused at connection time. You can revoke a device in the dialog.

```bash
HERMES_UI_REMOTE=iroh HERMES_UI_URL=https://maxgierlachowski.github.io/hermes-ui/app npm start
npx hermes-ui pair     # or: node bin/hermes-ui.mjs pair
```

### Mobile app (Android/iOS)

[`mobile-app/`](mobile-app/README.md) is the native app for phones: React Native (Expo SDK 58, New
Architecture) with native screens, not a WebView. It talks to the same backend through the same
`iroh-gateway`; nothing on the host changes.

- **Structure.** `mobile-app/modules/expo-iroh` is a native iroh client: a small Rust crate around
  iroh-bridge's `client-core` (the same client the browser's `iroh-fetch` uses), exposed to Kotlin and
  Swift through UniFFI and to JavaScript as a fetch-like API with SSE streams and file downloads. Unlike
  the browser it hole-punches a direct UDP path and uses the relay only to start. Types, the SSE parser,
  pairing links, media-tag rules and the English texts live in [`shared/`](shared), used by the web UI
  and the app alike.
- **Fast by default.** The board, inbox, the newest messages of each chat and Paseo transcripts are
  cached on the device: the app shows the last state at once (also offline, with "as of …"), refreshes
  in the background and shows a thin progress bar while it does.
- **Build locally (Android).** Node 24, JDK 17, Android SDK + NDK, Rust via rustup with the Android
  targets and `cargo-ndk`; then `cd mobile-app && npm install && npm run iroh:android && npx expo
  prebuild -p android && npm run apk`. iOS builds for the simulator (`npm run iroh:ios`, `npx expo
  run:ios`); a device or TestFlight build needs an Apple developer account.
- **Signing.** Release APKs are signed with a local keystore in `mobile-app/.secrets/` (git-ignored,
  never committed). Keep it: Android installs an update over the existing app only if it is signed with
  the same key. Raise `android.versionCode` in `mobile-app/app.config.ts` for every release.
- **Pairing.** Same links as the web UI: scan the QR code of `hermes-ui pair` (or the "Pair device"
  dialog), open the `https://<ui>/#iroh=…` link, or paste it. The device key lives in the Android
  Keystore / iOS Keychain, so the gateway keeps recognising the phone across updates.
- **Push (FCM).** Without Firebase the app notifies while it runs, and in the background through an
  optional keep-alive service. For push with the app closed, build with
  `GOOGLE_SERVICES_JSON=/path/to/google-services.json` and start the backend with
  `HERMES_UI_FCM_SERVICE_ACCOUNT=/path/to/service-account.json`; details in
  [`mobile-app/README.md`](mobile-app/README.md#push-with-the-app-closed-fcm).

### CLI

```
hermes-ui serve [options]   start the backend (default)
hermes-ui pair              print a pairing link + QR code
hermes-ui status            backend, remote and device status
hermes-ui help
```

## Configuration

Settings come from CLI flags, then environment variables, then `.env`, then the defaults. The former `KANBAN_*` names (from when the project was called hermes-kanban) still work as aliases, and `hermes-kanban` is still accepted as the CLI name.

| Env var | Flag | Default | Purpose |
|---|---|---|---|
| `HERMES_UI_PORT` | `--port` | `8787` | Local port. |
| `HERMES_UI_HOST` | `--host` | `127.0.0.1` | Address to bind. Loopback only (`127.0.0.1`, `::1`, `localhost`); anything else is refused. |
| `HERMES_UI_TOKEN` | `--token` | generated | Login token for local browsers (`HERMES_UI_AUTH=token`). |
| `HERMES_UI_AUTH` | `--auth` | `token` | `token`: board token, device cookies and pairing (standalone). `proxy`: a reverse proxy signs users in (see [Behind a reverse proxy](#behind-a-reverse-proxy-agentbox)). |
| `HERMES_UI_PROXY_SECRET` | – (env or `.env` only) | – | Proxy mode: the shared secret the proxy sends as `X-Agentbox-Proxy-Secret`. At least 16 characters; never pass it as a flag. |
| `HERMES_UI_BASE_PATH` | `--base-path` | – | URL prefix the browser sees, e.g. `/hermes`. Requests may arrive with the prefix stripped (Caddy `handle_path`) or kept. |
| `HERMES_UI_PAIRING_URL` | `--pairing-url` | – | Proxy mode: the page the "Pair device" button opens (e.g. `/devices?pair=1`), instead of minting codes here. |
| `HERMES_UI_SERVE_UI` | `--ui` | `on` | `off` = headless, API only. |
| `HERMES_UI_DIR` | `--ui-dir` | `web/dist` | Built UI to serve. |
| `HERMES_UI_URL` | `--ui-url` | – | Public URL of the static UI, used in iroh pairing links. |
| `HERMES_UI_REMOTE` | `--remote` | `off` | `off` \| `iroh`. Always `off` in proxy mode. |
| `HERMES_UI_LANG` | `--lang` | `en` | Language of server-generated texts (`en`, `de`). The UI follows the browser; change it in ⌘K. |
| `HERMES_UI_DATA_DIR` | `--data-dir` | `./data` | Board state, paired devices, iroh gateway key, inbox history, VAPID keys and push subscriptions. |
| `HERMES_UI_IMAGE_ROOTS` | `--image-roots` | – | Extra directories (separated by `:`) whose images transcripts may show. Always allowed: Hermes' image cache, `PASEO_HOME` and Paseo's `paseo-attachments-*` temp dirs. |
| `PASEO_HOME` | `--paseo-home` | `~/.paseo` | Paseo home, allowed as an image root. |
| `HERMES_HOME` | `--hermes-home` | `~/.hermes` | Hermes data dir: `state.db`, `gateway.sock`. The board stays empty until `state.db` exists. |
| `HERMES_UI_PASEO` | `--paseo` | `auto` | `off` disables the Paseo integration. |
| `HERMES_UI_PASEO_SOURCE` | `--paseo-source` | `auto` | `mcp` (paseo-mcp ≥ 0.4.0 events), `daemon` (direct connection) or `auto` (mcp when available, otherwise daemon). |
| `PASEO_MCP_COMMAND` | `--paseo-mcp-command` | `paseo-mcp` if it is on `PATH` | stdio command for paseo-mcp. The event subscription runs with `PASEO_MCP_READONLY=1`; only an answer to a permission from the inbox starts a second, short-lived client without it. |
| `PASEO_MCP_URL`, `PASEO_MCP_TOKEN` | `--paseo-mcp-url`, `--paseo-mcp-token` | – | Paseo plugin's Streamable HTTP endpoint instead of stdio. Use a token with the `read` scope. |
| `PASEO_MCP_WRITE_TOKEN` | `--paseo-mcp-write-token` | – | HTTP only: a token allowed to call `paseo_respond_permission`. |
| `HERMES_UI_PASEO_RESPOND` | `--paseo-respond` | `on` | `off` = the inbox shows Paseo permissions but cannot answer them. |
| `HERMES_UI_PUSH` | `--push` | `on` | `off` disables Web Push. |
| `HERMES_UI_PUSH_SUBJECT` | `--push-subject` | `HERMES_UI_URL` if https | VAPID subject (`mailto:` or `https:`); Apple rejects anything else. |
| `HERMES_UI_FCM_SERVICE_ACCOUNT` | `--fcm-service-account` | – | Firebase service-account JSON: push to the native Android app through FCM, next to Web Push. See [mobile-app/README.md](mobile-app/README.md). |
| `HERMES_UI_INBOX_DAYS`, `HERMES_UI_INBOX_MAX` | `--inbox-days`, `--inbox-max` | `30`, `1000` | How long / how many inbox entries are kept. |
| `PASEO_DAEMON_URL` | `--paseo-url` | from `PASEO_MCP_CONFIG`, else `ws://127.0.0.1:6767/ws` | Paseo daemon. |
| `PASEO_MCP_CONFIG` | `--paseo-mcp-config` | `~/.config/paseo-mcp/config.json` | Where the daemon URL is read from. |
| `PASEO_OPS_FILE` | `--paseo-ops-file` | `$HERMES_HOME/ops-loop/paseo.json` | Optional agent goal / phase file. |
| `IROH_GATEWAY_BIN` | `--iroh-gateway-bin` | auto-download | Path to an `iroh-gateway` binary. |
| `IROH_GATEWAY_VERSION` | `--iroh-gateway-version` | `v0.6.4` | iroh-gateway release to download. |
| `IROH_RELAY_URL` / `IROH_RELAY_TOKEN` | `--iroh-relay` | n0 public relays | Your own [iroh-relay](https://github.com/irohkit/iroh-bridge/blob/main/deploy/relay/README.md). |
| `HERMES_UI_ENV_FILE` | – (env only) | `./.env` | The `.env` file to read. (Node 24 itself claims an `--env-file` argument.) |

### Remote access

`HERMES_UI_REMOTE` is `off` (local only, or behind a reverse proxy) or `iroh`, the built-in remote access described above: end-to-end encrypted through a relay (n0's public relays or your own), no account, no open port, the gateway allow-lists paired devices, and the UI is hosted somewhere static once.

In every mode the backend stays on loopback:

- New devices can only be paired from the host.
- Failed logins are rate-limited.
- iroh requests are authorised by the gateway-verified `X-Iroh-Remote-Id`. It is trusted only from the local gateway child, and tokens and cookies are ignored for these requests.

### Behind a reverse proxy (agentbox)

hermes-ui can run behind a reverse proxy that signs users in and puts the UI below a path prefix. [agentbox](https://github.com/MaxGierlachowski/agentbox) runs it this way: its Caddy serves `/hermes/*` from `127.0.0.1:8787`, and agentbox owns sign-in, device pairing and the iroh gateway.

```bash
HERMES_UI_PORT=8787 HERMES_UI_HOST=127.0.0.1 HERMES_UI_REMOTE=off \
HERMES_UI_AUTH=proxy HERMES_UI_PROXY_SECRET=<from a root-only env file> \
HERMES_UI_BASE_PATH=/hermes HERMES_UI_DATA_DIR=/var/lib/agentbox/hermes-ui \
HERMES_UI_PAIRING_URL='/devices?pair=1' HERMES_HOME=/home/agentbox/.hermes \
PASEO_MCP_URL=<paseo-mcp HTTP endpoint> PASEO_MCP_TOKEN=<read token> \
node hermes-ui/bin/hermes-ui.mjs serve
```

- **Auth (`HERMES_UI_AUTH=proxy`).** A request is authorised if and only if `X-Agentbox-Proxy-Secret` equals `HERMES_UI_PROXY_SECRET` (compared in constant time) **and** `X-Agentbox-User` is non-empty; otherwise `401`. The proxy must remove both headers from client requests before it sets them. In proxy mode the token login, device cookies, pairing codes (`/api/pair`, `/api/pair/redeem`, `/api/devices`) and the built-in iroh gateway are off, and no token is generated or written. `GET /api/health` answers without auth only on a direct loopback request (no forwarding headers), for health checks.
- **Base path (`HERMES_UI_BASE_PATH=/hermes`).** The build uses relative URLs only. When the backend serves `index.html` it adds `<base href="/hermes/">` and a `<meta name="hermes-ui-config">` tag with the base path, the auth mode and the pairing URL, so assets, API calls, the event stream (SSE), media, the service worker (scope `/hermes/`) and the web manifest all stay below `/hermes/`. The same `web/dist` works at `/` and below any prefix. The backend accepts requests with the prefix stripped or kept, and redirects `/hermes` to `/hermes/`.
- **Pairing (`HERMES_UI_PAIRING_URL`).** The remote-access dialog shows a "Pair device" button that opens this URL in a new tab instead of minting codes.
- **Caddy**, the shape agentbox uses (its `forward_auth` sets the user):

  ```caddyfile
  redir /hermes /hermes/ 308
  handle_path /hermes/* {
  	request_header -X-Agentbox-User
  	request_header -X-Agentbox-Proxy-Secret
  	# forward_auth … copy_headers X-Agentbox-User
  	reverse_proxy 127.0.0.1:8787 {
  		header_up X-Agentbox-Proxy-Secret {env.HERMES_UI_PROXY_SECRET}
  	}
  }
  ```

- **PWA over iroh with a base path.** A pairing link may carry `base`: `<ui-url>/#iroh=<endpoint id>&pair=<code>&base=/hermes[&relay=<relay url>]`. The PWA keeps a persistent iroh identity, stores the endpoint and the base, sends `POST {base}/api/pair/redeem` with `{"code": "<code>", "name": "<device name>"}` through iroh-fetch (agentbox answers that path from its own device registry), and from then on prefixes every API call, the event stream and media with `{base}`. Without `base` nothing changes.
- **Prefilled chats.** `?compose=<url-encoded text>` on the app URL (e.g. `/hermes/?compose=Review%20PR%2042`) opens a new chat with the composer prefilled. Nothing is sent until the user sends it.

### Release tarball

```bash
npm run release:tarball      # → dist/hermes-ui-<version>.tgz and dist/hermes-ui-<version>.tgz.sha256
```

The tarball holds one directory, `hermes-ui/`, with `bin/`, `src/`, `shared/`, `server.mjs`, the prebuilt `web/dist`, production `node_modules`, `README.md`, `LICENSE` and the service-file generators. It needs no network and no `npm install`: unpack it and run `node hermes-ui/bin/hermes-ui.mjs serve` (Node 24). All dependencies are plain JavaScript; the build fails if a compiled addon or an install script shows up in `node_modules`, so one tarball serves Linux x64/arm64 and macOS alike. The `.sha256` file is in `sha256sum` format (`sha256sum -c`). The build ends with a smoke test of the unpacked copy in proxy mode below `/hermes`.

### Autostart (Linux, systemd)

```bash
node scripts/systemd-unit.mjs --user hermes --environment-file /etc/hermes-ui.env \
  --working-dir /opt/hermes-ui --node /usr/bin/node | sudo tee /etc/systemd/system/hermes-ui.service
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-ui
```

Options: `--user`, `--group`, `--environment-file` (put `HERMES_UI_*` settings and secrets there, never on the command line), `--working-dir`, `--node`, `--set KEY=VALUE` (extra non-secret `Environment=` lines); arguments after `--` go to `hermes-ui serve`.

### Autostart (macOS)

```bash
node scripts/launchd-plist.mjs --remote iroh > ~/Library/LaunchAgents/io.github.hermes-ui.plist
launchctl load ~/Library/LaunchAgents/io.github.hermes-ui.plist
```

`examples/io.github.hermes-ui.plist` shows the shape of the plist.

## Features

- **Board:** drag & drop (dnd-kit). On a phone it switches to tabs per column.
- **Column rules:**
  - Doing: Hermes is running a turn, or a Paseo agent the session owns is still running ("Paseo running (n)").
  - Waiting: the turn has finished and nothing of the session runs any more, or there is an open approval or clarify prompt.
  - Done: **only you** set it, and it sticks until you write in that session again.
  - Finished cron, webhook and one-shot runs go to Done; they are visible behind the "Cron/system" filter.
- **Thread panel:**
  - Full transcript with tool calls (collapsible) and images, live streaming, stop button.
  - Composer with text, images (paste or drag & drop) and voice messages. Voice is recorded with MediaRecorder and transcribed by Hermes' own STT.
- **Approvals and questions:** shown on the card and inline in the thread.
  - Approval: approve with the options Hermes offers (once / session / always) or deny.
  - Clarify: answer with buttons, multi-select or free text, or skip. A countdown shows when Hermes gives a time limit.
- **Paseo agents (optional; read-only except answering permissions from the inbox):**
  - The board finds a session's agents from the session's own `paseo_*` tool calls and shows them as chips with their live state.
  - The live state comes from [paseo-mcp](https://github.com/MaxGierlachowski/paseo-mcp) events (≥ 0.4.0): a subscription to the `paseo://agents` resource, with no polling. A direct daemon connection is the fallback. When the daemon is reachable it also provides richer transcripts and the app deep link.
  - The "Paseo agents" tab lists them; a transcript view shows each one read-only, updating live while the agent runs.
  - A deep link (`paseo://h/<server>/agent/<id>`) opens the agent in the Paseo app.
  - Images that agents reference by local path (`file:///…`, `/home/…`) are served read-only by `/api/file`: image types only, only below the allowed roots (see `HERMES_UI_IMAGE_ROOTS`), checked on the real path. Missing files show a placeholder; a click opens a lightbox.
  - Files Hermes attaches to a reply with `MEDIA:<path>` (what Slack shows as attachments) appear under the message: images, audio players, other files by name. Only exactly those referenced files become readable, the tags never show up in the text, not even while streaming.
- **Tabs:** Board and Inbox, in the header on a desktop and as a bottom tab bar on a phone. The tab is part of the URL (`#/board`, `#/inbox`, `#/inbox/<session>`), so a reload or a link keeps it. `g b` / `g i` switch.
- **Inbox (across all chats):**
  - *Needs you:* every open Hermes approval and clarify question of every followed session, answerable in place with the same controls and countdown as in the thread, and every Paseo agent with a pending permission (agent, tool, command or description), answerable with Allow / Deny via paseo-mcp's `paseo_respond_permission`. Each entry names its chat and links to the thread.
  - *History:* requests and how they were answered (here, elsewhere, expired), finished chats, errors, Paseo agents that finished, failed or hit a usage limit. Read/unread, "mark all read", filters by kind and source, grouped by day. Stored in `<data-dir>/inbox.json` (30 days / 1000 entries by default).
  - A Hermes chat counts as *done* only when Hermes' turn is over **and** none of the Paseo agents it started or steers is still running or waiting for a permission (the same rule as the columns). A Paseo agent finishing is its own entry.
- **In-app notifications:** toasts for new requests and finished chats while the app is visible (a click opens the thread or the inbox), a badge on the Inbox tab and on the app icon (Badging API where available).
- **Push notifications (Web Push, see below).**
- **Search (⌘K, `/` or the search field):** full text over the titles and content of all chats, using Hermes' own FTS5 index (`messages_fts`, read-only; user and Hermes messages, no tool output). Results show title, source, column, last activity, message and Paseo-agent counts and a snippet with the hit marked; Enter opens the thread at the matching message. Archived chats on request. Also: new chat (N), theme, language, cron/system filter, remote access.
- **Light and dark mode**, English and German, a mobile layout, and installable as a PWA.
- **Phones and tablets:** every control is at least 44 × 44 px to hit (Apple HIG; checked by a test), fields use 16 px text so iOS does not zoom in, and nothing changes for a mouse.
  - The thread opens as a bottom sheet: drag it down to close. The composer is one row (attach · text · one round button that is the mic, send, or stop), Enter makes a new line, and it stays above the keyboard on iOS too.
  - Board: column tabs, swipe sideways to switch columns, long-press a card to move it. Column choice, new chat, notifications and remote access open as bottom sheets; search is full screen.
  - Images (thread, attachments, Paseo transcripts) open full screen: pinch or double-tap to zoom the image only (the app itself never zooms), drag to pan, swipe down to close.

## Push notifications

Standard Web Push with VAPID. The backend generates its key pair on first start (`<data-dir>/vapid.json`, never part of the repo) and sends outgoing HTTPS requests to whatever push service the browser uses (Apple, Google, Mozilla). No server of your own and no inbound port is needed, also not in iroh mode.

- **Enable** in Inbox → bell icon (or ⌘K → Notifications). Browsers only ask for permission after a click.
- **iPhone / iPad:** push works only in the app added to the Home Screen (iOS / iPadOS 16.4 or later): Safari → Share → *Add to Home Screen*, open it from there, then enable. The settings dialog explains this when it runs in plain Safari.
- **Per device:** which kinds push (approvals and questions, done, errors and limits, Paseo agents at all), optional quiet hours (in the device's time zone) and "don't push while the app is open and visible" (the UI reports its visibility; then only the in-app toast appears).
- **Payload:** only the chat title and the kind ("Approval needed", "Done", "Error"). A click opens the thread or the inbox. On browsers with reliable notification actions (not Apple's push service) Hermes approvals get *Allow …* / *Deny …*; these open the app with a confirmation dialog and never answer by themselves.
- **Lifecycle:** subscriptions belong to a paired device and are deleted when it is unpaired or signs out; subscriptions the push service reports as gone (404/410) are removed.
- **Service worker:** `web/public/sw.js` is the one worker for the UI's scope. It imports iroh-fetch's `iroh-sw.js` (media over iroh) and adds the `push` and `notificationclick` handlers.

## How it talks to Hermes

- **Read:** `$HERMES_HOME/state.db`, opened read-only (`node:sqlite`) and polled every 1.5 s, plus the Hermes gateway's event stream.
- **Write:** like the Hermes desktop app does it. The backend gets a single-use ticket from `gateway.sock`, then uses the gateway WebSocket with JSON-RPC `session.create`, `prompt.submit`, `session.resume`, `session.interrupt`, `approval.respond` and `clarify.respond`. Images go through `/api/chat/image-upload`, voice through `/api/audio/transcribe`.
- **Never:** it writes nothing under `$HERMES_HOME`, never restarts the Hermes gateway, and sends no commands to the Paseo daemon. The one write to Paseo is your own answer to a permission request from the inbox, through paseo-mcp.

## Development

```bash
npm start                 # terminal 1: backend (+ built UI)
npm run dev               # terminal 2: Vite dev server for web/ on :5173, proxies /api to :8787
npm run check             # syntax check of the backend
npm test                  # backend unit and server tests (proxy auth, base path, …)
npm run test:ui           # build the UI, then the Playwright UI tests (web/e2e)
```

The UI tests run the built bundle with every `/api` request answered from synthetic fixtures (`web/e2e/fixtures.ts`), so they need no backend and never touch Hermes. They cover three phones (390 × 844, 375 × 667, 412 × 915, touch) and a desktop:

- `touch-targets`: every interactive element on every screen must be hittable over 44 × 44 px (measured by hit-testing, so an enlarged hit area counts and an overlapping neighbour fails), and no field may be below 16 px.
- `mobile-behaviour`: sheet swipe-to-close, long-press, column swipe, Enter in the composer, the keyboard inset, and the image viewer (pinch, double tap, swipe down; the page scale must stay 1).
- `desktop-regression`: pixel comparison at 1440 × 900, light and dark, against `web/e2e/__screenshots__/`. Touch styles live behind `pointer: coarse` (Tailwind variant `touch:`) or `max-md:`, so a desktop with a mouse must not change by a single pixel. After an intended desktop change, update the images with `npx playwright test desktop --update-snapshots` (in `web/`) and review them. The images are rendered on macOS; other systems render fonts differently.
- `desktop-agentbox`: base path (everything below `/hermes/`), proxy-mode pairing button, `?compose=`, and `base=` in pairing links.
- `SHOTS_DIR=<dir> npx playwright test screenshots` writes one screenshot per screen, phone and theme.

Once per machine: `npx playwright install chromium` in `web/`.

Layout:

- `server.mjs`: HTTP API and SSE.
- `src/`: Hermes gateway client, state.db reader, Paseo adapter (`paseo.mjs`, `paseo-mcp-source.mjs`), inbox history (`inbox.mjs`), Web Push (`push.mjs`), iroh, devices, config, `index.html` rendering for the base path (`page.mjs`).
- `scripts/`: launchd and systemd service files, the release tarball, the GitHub Pages build.
- `bin/`: CLI.
- `web/`: React + Vite + Tailwind + shadcn/ui.

## Licenses

Hermes UI is released under the **MIT** license (see `LICENSE`). The components it uses are all free and open source:

| Component | Use | License |
|---|---|---|
| iroh-fetch, iroh-gateway ([iroh-bridge](https://github.com/irohkit/iroh-bridge)) | Remote access over iroh | MIT |
| @getpaseo/client | Read-only Paseo daemon access (fallback) | Apache-2.0 |
| @modelcontextprotocol/sdk | paseo-mcp client (events) | MIT |
| web-push | Web Push (VAPID, payload encryption) | MPL-2.0 |
| shadcn/ui, Radix UI, Base UI | UI components | MIT |
| Dice UI Kanban, dnd-kit | Board and drag & drop | MIT |
| prompt-kit | Chat input and thread | MIT |
| cmdk, sonner, react-resizable-panels, next-themes | Palette, toasts, panels, theme | MIT |
| react-zoom-pan-pinch | Pinch and double-tap zoom in the image viewer on touch screens | MIT |
| lucide-react | Icons | ISC |
| Tailwind CSS, @tailwindcss/typography, tw-animate-css | Styling | MIT |
| react-markdown, remark-gfm, marked, use-stick-to-bottom | Chat rendering | MIT |
| class-variance-authority | Variants | Apache-2.0 |
| Geist | Font | OFL-1.1 |
| qrcode | Pairing QR codes | MIT |
