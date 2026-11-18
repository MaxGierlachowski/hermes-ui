# Hermes UI

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

1. Use the hosted UI at <https://maxgierlachowski.github.io/hermes-ui/> (built from this repo by `.github/workflows/pages.yml`), or host `web/dist` yourself on any static host. It works from any path. Set its URL as `HERMES_UI_URL`.
2. Start the backend with `--remote iroh` (or `HERMES_UI_REMOTE=iroh`). On first start it downloads `iroh-gateway` for your platform from the [iroh-bridge releases](https://github.com/irohkit/iroh-bridge/releases) and verifies its SHA-256. Alternatively set `IROH_GATEWAY_BIN`.
3. Pair the device:
   - Run `hermes-ui pair`, or open the remote-access dialog (📱) on the host and press "Pair device".
   - Scan the QR code. The link carries the gateway's endpoint id and a one-time code, both in the `#fragment`, which no web server sees.
4. The browser keeps a stable iroh identity. From then on the gateway only admits paired devices: everyone else is refused at connection time. You can revoke a device in the dialog.

```bash
HERMES_UI_REMOTE=iroh HERMES_UI_URL=https://maxgierlachowski.github.io/hermes-ui npm start
npx hermes-ui pair     # or: node bin/hermes-ui.mjs pair
```

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
| `HERMES_UI_PORT` | `--port` | `8787` | Local port. The host is always `127.0.0.1`. |
| `HERMES_UI_TOKEN` | `--token` | generated | Login token for local browsers. |
| `HERMES_UI_SERVE_UI` | `--ui` | `on` | `off` = headless, API only. |
| `HERMES_UI_DIR` | `--ui-dir` | `web/dist` | Built UI to serve. |
| `HERMES_UI_URL` | `--ui-url` | – | Public URL of the static UI, used in iroh pairing links. |
| `HERMES_UI_REMOTE` | `--remote` | `off` | `off` \| `iroh` \| `tailscale-funnel` \| `tailscale-serve` \| `cloudflare`. |
| `HERMES_UI_LANG` | `--lang` | `en` | Language of server-generated texts (`en`, `de`). The UI follows the browser; change it in ⌘K. |
| `HERMES_UI_DATA_DIR` | `--data-dir` | `./data` | Board state, paired devices, tunnel state, inbox history, VAPID keys and push subscriptions. |
| `HERMES_UI_IMAGE_ROOTS` | `--image-roots` | – | Extra directories (separated by `:`) whose images transcripts may show. Always allowed: Hermes' image cache, `PASEO_HOME` and Paseo's `paseo-attachments-*` temp dirs. |
| `PASEO_HOME` | `--paseo-home` | `~/.paseo` | Paseo home, allowed as an image root. |
| `HERMES_HOME` | `--hermes-home` | `~/.hermes` | Hermes data dir: `state.db`, `gateway.sock`. |
| `HERMES_UI_PASEO` | `--paseo` | `auto` | `off` disables the Paseo integration. |
| `HERMES_UI_PASEO_SOURCE` | `--paseo-source` | `auto` | `mcp` (paseo-mcp ≥ 0.4.0 events), `daemon` (direct connection) or `auto` (mcp when available, otherwise daemon). |
| `PASEO_MCP_COMMAND` | `--paseo-mcp-command` | `paseo-mcp` if it is on `PATH` | stdio command for paseo-mcp. The event subscription runs with `PASEO_MCP_READONLY=1`; only an answer to a permission from the inbox starts a second, short-lived client without it. |
| `PASEO_MCP_URL`, `PASEO_MCP_TOKEN` | `--paseo-mcp-url`, `--paseo-mcp-token` | – | Paseo plugin's Streamable HTTP endpoint instead of stdio. Use a token with the `read` scope. |
| `PASEO_MCP_WRITE_TOKEN` | `--paseo-mcp-write-token` | – | HTTP only: a token allowed to call `paseo_respond_permission`. |
| `HERMES_UI_PASEO_RESPOND` | `--paseo-respond` | `on` | `off` = the inbox shows Paseo permissions but cannot answer them. |
| `HERMES_UI_PUSH` | `--push` | `on` | `off` disables Web Push. |
| `HERMES_UI_PUSH_SUBJECT` | `--push-subject` | `HERMES_UI_URL` if https | VAPID subject (`mailto:` or `https:`); Apple rejects anything else. |
| `HERMES_UI_INBOX_DAYS`, `HERMES_UI_INBOX_MAX` | `--inbox-days`, `--inbox-max` | `30`, `1000` | How long / how many inbox entries are kept. |
| `PASEO_DAEMON_URL` | `--paseo-url` | from `PASEO_MCP_CONFIG`, else `ws://127.0.0.1:6767/ws` | Paseo daemon. |
| `PASEO_MCP_CONFIG` | `--paseo-mcp-config` | `~/.config/paseo-mcp/config.json` | Where the daemon URL is read from. |
| `PASEO_OPS_FILE` | `--paseo-ops-file` | `$HERMES_HOME/ops-loop/paseo.json` | Optional agent goal / phase file. |
| `IROH_GATEWAY_BIN` | `--iroh-gateway-bin` | auto-download | Path to an `iroh-gateway` binary. |
| `IROH_RELAY_URL` / `IROH_RELAY_TOKEN` | `--iroh-relay` | n0 public relays | Your own [iroh-relay](https://github.com/irohkit/iroh-bridge/blob/main/deploy/relay/README.md). |
| `TS_AUTHKEY`, `TS_HOSTNAME` | `--ts-authkey` | – / `hermes-ui` | Tailscale modes. |
| `CLOUDFLARED_BIN`, `TAILSCALE_BIN`, `TAILSCALED_BIN` | – | from `PATH` | Tunnel binaries. |

### Remote modes compared

| Mode | Account needed | App on the phone | Stable address | Notes |
|---|---|---|---|---|
| **`iroh`** (recommended) | none | no; the UI runs in the browser (WASM) | yes: the endpoint id plus a static UI URL | End-to-end encrypted through a relay (n0's public relays or your own). The gateway allow-lists paired devices. The UI has to be hosted somewhere static once. |
| `tailscale-funnel` | Tailscale (free) | no | yes: `https://<host>.<tailnet>.ts.net` | Runs its own userspace `tailscaled` (state in the data dir). Public URL, protected by device cookies. |
| `tailscale-serve` | Tailscale | Tailscale app | yes | Reachable only inside the tailnet. |
| `cloudflare` (fallback) | none | no | no: a new `trycloudflare.com` URL on every start | Quick tunnels have no SLA, and Cloudflare documents no SSE support for them. Kept as a fallback only. |

In every mode the backend stays on `127.0.0.1`:

- New devices can only be paired from the host.
- Failed logins are rate-limited.
- iroh requests are authorised by the gateway-verified `X-Iroh-Remote-Id`. It is trusted only from the local gateway child, and tokens and cookies are ignored for these requests.

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
  - Images that agents reference by local path (`file:///…`, `/Users/…`) are served read-only by `/api/file`: image types only, only below the allowed roots (see `HERMES_UI_IMAGE_ROOTS`), checked on the real path. Missing files show a placeholder; a click opens a lightbox.
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
```

Layout:

- `server.mjs`: HTTP API and SSE.
- `src/`: Hermes gateway client, state.db reader, Paseo adapter (`paseo.mjs`, `paseo-mcp-source.mjs`), inbox history (`inbox.mjs`), Web Push (`push.mjs`), iroh, tunnels, devices, config.
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
| lucide-react | Icons | ISC |
| Tailwind CSS, @tailwindcss/typography, tw-animate-css | Styling | MIT |
| react-markdown, remark-gfm, marked, use-stick-to-bottom | Chat rendering | MIT |
| class-variance-authority | Variants | Apache-2.0 |
| Geist | Font | OFL-1.1 |
| qrcode | Pairing QR codes | MIT |
| cloudflared / Tailscale (external binaries, optional) | Tunnels | Apache-2.0 / BSD-3-Clause |
