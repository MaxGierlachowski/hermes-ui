# Configuration

All settings of the backend. A template with every variable: [`.env.example`](../.env.example).
Related: [self-hosting.md](self-hosting.md) · [security.md](security.md) · [architecture.md](architecture.md).


Settings come from CLI flags, then environment variables, then `.env`, then the defaults. The former `KANBAN_*` names (from when the project was called hermes-kanban) still work as aliases, and `hermes-kanban` is still accepted as the CLI name.

| Env var | Flag | Default | Purpose |
|---|---|---|---|
| `HERMES_UI_PORT` | `--port` | `8787` | Local port. The host is always `127.0.0.1`. |
| `HERMES_UI_TOKEN` | `--token` | generated | Login token for local browsers. |
| `HERMES_UI_SERVE_UI` | `--ui` | `on` | `off` = headless, API only. |
| `HERMES_UI_DIR` | `--ui-dir` | `web/dist` | Built UI to serve. |
| `HERMES_UI_URL` | `--ui-url` | – | Public URL of the static UI, used in iroh pairing links. |
| `HERMES_UI_CORS_ORIGINS` | `--cors-origins` | – | Extra origins (comma separated) whose pages may call the API with the token (Bearer, no cookies). The desktop app's `tauri://localhost` is always allowed. |
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
| `HERMES_UI_FCM_SERVICE_ACCOUNT` | `--fcm-service-account` | – | Firebase service-account JSON: push to the native Android app through FCM, next to Web Push. See [app.md](app.md). |
| `HERMES_UI_INBOX_DAYS`, `HERMES_UI_INBOX_MAX` | `--inbox-days`, `--inbox-max` | `30`, `1000` | How long / how many inbox entries are kept. |
| `PASEO_DAEMON_URL` | `--paseo-url` | from `PASEO_MCP_CONFIG`, else `ws://127.0.0.1:6767/ws` | Paseo daemon. |
| `PASEO_MCP_CONFIG` | `--paseo-mcp-config` | `~/.config/paseo-mcp/config.json` | Where the daemon URL is read from. |
| `PASEO_OPS_FILE` | `--paseo-ops-file` | `$HERMES_HOME/ops-loop/paseo.json` | Optional agent goal / phase file. |
| `IROH_GATEWAY_BIN` | `--iroh-gateway-bin` | auto-download | Path to an `iroh-gateway` binary. |
| `IROH_RELAY_URL` / `IROH_RELAY_TOKEN` | `--iroh-relay` | n0 public relays | Your own [iroh-relay](https://github.com/irohkit/iroh-bridge/blob/main/deploy/relay/README.md). |
| `TS_AUTHKEY`, `TS_HOSTNAME` | `--ts-authkey` | – / `hermes-ui` | Tailscale modes. |
| `CLOUDFLARED_BIN`, `TAILSCALE_BIN`, `TAILSCALED_BIN` | – | from `PATH` | Tunnel binaries. |

## Remote modes compared

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

## Autostart (macOS)

```bash
node server/scripts/launchd-plist.mjs --remote iroh > ~/Library/LaunchAgents/io.github.hermes-ui.plist
launchctl load ~/Library/LaunchAgents/io.github.hermes-ui.plist
```

`server/examples/io.github.hermes-ui.plist` shows the shape of the plist.

