# Hermes Kanban

A Kanban board for [Hermes Agent](https://hermes-agent.nousresearch.com) sessions. Every chat (desktop, Slack, cron, CLI, or one started from the board) is a card. Cards move between **New Task → Doing → Waiting → Done** live.

On the board you can:

- start and continue chats with text, images and voice messages,
- answer Hermes' approval and clarify prompts on the card,
- see the [Paseo](https://paseo.sh) coding agents a session started, with read-only transcripts.

It has two parts:

- a **headless backend** (`hermes-kanban serve`), which binds to `127.0.0.1` only;
- a **standalone UI**, a static PWA without any data or secrets. The backend can serve the UI itself, or you host it anywhere (GitHub Pages, any static host) and it reaches your backend over **iroh**: end-to-end encrypted, no open port, no account.

```
 Phone / iPad / any browser                        your machine (behind NAT)
┌──────────────────────────┐                     ┌──────────────────────────────────────────────┐
│ UI (static PWA)          │     iroh relay      │ iroh-gateway ──HTTP──▶ hermes-kanban backend │
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
git clone <repo> hermes-kanban && cd hermes-kanban
npm install          # also installs the UI (web/)
npm start            # builds the UI, starts the backend on http://127.0.0.1:8787
```

The first start writes `KANBAN_TOKEN` to `.env`. Open <http://127.0.0.1:8787/> and sign in with it once; an HttpOnly cookie keeps you signed in.

Requirements:

- Node.js 24 or newer.
- A running Hermes gateway. The desktop app starts one; otherwise run `hermes gateway run`.
- Optional: a Paseo daemon.

### Use it from a phone or tablet (iroh, recommended)

1. Host the UI somewhere static. `web/dist` (built by `npm run build`) works from any path, for example on GitHub Pages. Set its URL as `KANBAN_UI_URL`.
2. Start the backend with `--remote iroh` (or `KANBAN_REMOTE=iroh`). On first start it downloads `iroh-gateway` for your platform from the [iroh-bridge releases](https://github.com/irohkit/iroh-bridge/releases) and verifies its SHA-256. Alternatively set `IROH_GATEWAY_BIN`.
3. Pair the device:
   - Run `hermes-kanban pair`, or open the remote-access dialog (📱) on the host and press "Pair device".
   - Scan the QR code. The link carries the gateway's endpoint id and a one-time code, both in the `#fragment`, which no web server sees.
4. The browser keeps a stable iroh identity. From then on the gateway only admits paired devices: everyone else is refused at connection time. You can revoke a device in the dialog.

```bash
KANBAN_REMOTE=iroh KANBAN_UI_URL=https://<you>.github.io/hermes-kanban npm start
npx hermes-kanban pair     # or: node bin/hermes-kanban.mjs pair
```

### CLI

```
hermes-kanban serve [options]   start the backend (default)
hermes-kanban pair              print a pairing link + QR code
hermes-kanban status            backend, remote and device status
hermes-kanban help
```

## Configuration

Settings come from CLI flags, then environment variables, then `.env`, then the defaults.

| Env var | Flag | Default | Purpose |
|---|---|---|---|
| `KANBAN_PORT` | `--port` | `8787` | Local port. The host is always `127.0.0.1`. |
| `KANBAN_TOKEN` | `--token` | generated | Login token for local browsers. |
| `KANBAN_UI` | `--ui` | `on` | `off` = headless, API only. |
| `KANBAN_UI_DIR` | `--ui-dir` | `web/dist` | Built UI to serve. |
| `KANBAN_UI_URL` | `--ui-url` | – | Public URL of the static UI, used in iroh pairing links. |
| `KANBAN_REMOTE` | `--remote` | `off` | `off` \| `iroh` \| `tailscale-funnel` \| `tailscale-serve` \| `cloudflare`. |
| `KANBAN_LANG` | `--lang` | `en` | Language of server-generated texts (`en`, `de`). The UI follows the browser; change it in ⌘K. |
| `KANBAN_DATA_DIR` | `--data-dir` | `./data` | Board state, paired devices, tunnel state. |
| `HERMES_HOME` | `--hermes-home` | `~/.hermes` | Hermes data dir: `state.db`, `gateway.sock`. |
| `KANBAN_PASEO` | `--paseo` | `auto` | `off` disables the Paseo integration. |
| `PASEO_DAEMON_URL` | `--paseo-url` | from `PASEO_MCP_CONFIG`, else `ws://127.0.0.1:6767/ws` | Paseo daemon. |
| `PASEO_MCP_CONFIG` | `--paseo-mcp-config` | `~/.config/paseo-mcp/config.json` | Where the daemon URL is read from. |
| `PASEO_OPS_FILE` | `--paseo-ops-file` | `$HERMES_HOME/ops-loop/paseo.json` | Optional agent goal / phase file. |
| `IROH_GATEWAY_BIN` | `--iroh-gateway-bin` | auto-download | Path to an `iroh-gateway` binary. |
| `IROH_RELAY_URL` / `IROH_RELAY_TOKEN` | `--iroh-relay` | n0 public relays | Your own [iroh-relay](https://github.com/irohkit/iroh-bridge/blob/main/deploy/relay/README.md). |
| `TS_AUTHKEY`, `TS_HOSTNAME` | `--ts-authkey` | – / `hermes-kanban` | Tailscale modes. |
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
node scripts/launchd-plist.mjs --remote iroh > ~/Library/LaunchAgents/io.github.hermes-kanban.plist
launchctl load ~/Library/LaunchAgents/io.github.hermes-kanban.plist
```

`examples/io.github.hermes-kanban.plist` shows the shape of the plist.

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
- **Paseo agents (optional, read-only):**
  - The board finds a session's agents from the session's own `paseo_*` tool calls and shows them as chips with their live state.
  - The "Paseo agents" tab lists them; a transcript view shows each one read-only, updating live while the agent runs.
  - A deep link (`paseo://h/<server>/agent/<id>`) opens the agent in the Paseo app.
- **⌘K palette:** sessions, new chat (N), theme, language, cron/system filter, remote access.
- **Light and dark mode**, English and German, a mobile layout, and installable as a PWA.

## How it talks to Hermes

- **Read:** `$HERMES_HOME/state.db`, opened read-only (`node:sqlite`) and polled every 1.5 s, plus the Hermes gateway's event stream.
- **Write:** like the Hermes desktop app does it. The backend gets a single-use ticket from `gateway.sock`, then uses the gateway WebSocket with JSON-RPC `session.create`, `prompt.submit`, `session.resume`, `session.interrupt`, `approval.respond` and `clarify.respond`. Images go through `/api/chat/image-upload`, voice through `/api/audio/transcribe`.
- **Never:** it writes nothing under `$HERMES_HOME`, never restarts the Hermes gateway, and sends no commands to the Paseo daemon.

## Development

```bash
npm start                 # terminal 1: backend (+ built UI)
npm run dev               # terminal 2: Vite dev server for web/ on :5173, proxies /api to :8787
npm run check             # syntax check of the backend
```

Layout:

- `server.mjs`: HTTP API and SSE.
- `src/`: Hermes gateway client, state.db reader, Paseo adapter, iroh, tunnels, devices, config.
- `bin/`: CLI.
- `web/`: React + Vite + Tailwind + shadcn/ui.

## Licenses

Hermes Kanban is released under the **MIT** license (see `LICENSE`). The components it uses are all free and open source:

| Component | Use | License |
|---|---|---|
| iroh-fetch, iroh-gateway ([iroh-bridge](https://github.com/irohkit/iroh-bridge)) | Remote access over iroh | MIT |
| @getpaseo/client | Read-only Paseo daemon access | Apache-2.0 |
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
