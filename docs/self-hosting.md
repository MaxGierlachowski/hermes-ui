# Self-hosting

Hermes UI runs on the same machine as Hermes Agent. You run the backend there; the UI is static and
can live anywhere. See also [architecture.md](architecture.md) and [security.md](security.md).

## Requirements

- **macOS or Linux.** The backend talks to Hermes over a Unix socket. Prebuilt `iroh-gateway`
  binaries exist for macOS and Linux on arm64 and x64; on other platforms set `IROH_GATEWAY_BIN`.
- **Node.js 24 or newer** (the backend uses `node:sqlite`). The repository pins a version in `.nvmrc`.
- **A running Hermes gateway.** The Hermes desktop app starts one; otherwise run `hermes gateway run`.
  The backend finds it through `$HERMES_HOME/gateway.sock` (default `~/.hermes`).
- **Optional:** Paseo (paseo-mcp ≥ 0.4.0 on the `PATH`, or a reachable daemon); `tailscale` /
  `tailscaled` or `cloudflared` for those remote modes.

The backend must run as the same user as Hermes: the gateway socket checks the Unix user.

## Install and start

```bash
git clone <repository-url> hermes-ui && cd hermes-ui
npm install      # backend, web UI and shared code (npm workspaces)
npm start        # builds web/dist, then starts the backend on http://127.0.0.1:8787
```

On the first start the backend writes `HERMES_UI_TOKEN` to `.env`. Open <http://127.0.0.1:8787/> and
sign in with it once; a device cookie keeps you signed in.

`npm start` always rebuilds the UI first. To start without a build, run `node bin/hermes-ui.mjs serve`.
The CLI also has `pair`, `install-gateway` and `status` (gateway connection, remote state, paired
devices). The iroh gateway logs to `data/iroh/gateway.log`.

## Configuration

Settings come from CLI flags, then environment variables, then `.env`, then defaults. Copy
`.env.example` to `.env` as a starting point. The full table of variables is in the
[configuration.md](configuration.md). The ones you are most likely to set:

| Variable | Why |
|---|---|
| `HERMES_UI_REMOTE` | `iroh` to reach the backend from a phone or tablet. |
| `HERMES_UI_URL` | Public URL of your static UI; pairing links point there. |
| `HERMES_UI_DATA_DIR` | Where state lives (default `./data`). |
| `HERMES_HOME` | If Hermes does not live in `~/.hermes`. |
| `HERMES_UI_SERVE_UI` | `off` for a headless backend (API only). |
| `HERMES_UI_LANG` | `de` for German server texts (card activity lines); the UI follows the browser. |
| `HERMES_UI_PASEO` | `off` if you do not use Paseo. |
| `HERMES_UI_IMAGE_ROOTS` | Extra directories whose images transcripts may show. Keep this narrow. |

## Remote access

The backend never opens a port. A remote mode starts a tunnel as a child process.

| Mode | Use when | What you need |
|---|---|---|
| `iroh` (recommended) | Phone, tablet or another computer, from anywhere | A static UI URL; nothing else |
| `tailscale-funnel` | You want a fixed `https://<host>.<tailnet>.ts.net` address without iroh | A Tailscale account; one login |
| `tailscale-serve` | Access only from devices in your tailnet | Tailscale on every device |
| `cloudflare` | A quick test without any account | `cloudflared`; the URL changes on every start; no SLA and no documented SSE support |

Why iroh is the default: [ADR 0001](decisions/0001-iroh-instead-of-tunnels.md).

### iroh step by step

1. Host the UI somewhere static (see below) and note its URL.
2. Start the backend:

   ```bash
   HERMES_UI_REMOTE=iroh HERMES_UI_URL=https://example.com/hermes-ui npm start
   ```

   The first start downloads `iroh-gateway` from the iroh-bridge releases and verifies its SHA-256
   (or run `node bin/hermes-ui.mjs install-gateway` beforehand). The gateway key is created in
   `data/iroh/`; it keeps your endpoint id stable across restarts.
3. Pair a device: run `node bin/hermes-ui.mjs pair` on the host, or open the remote-access dialog in
   the local UI and press "Pair device". Scan the QR code with the phone. The code is valid for
   10 minutes and works once.
4. For the native app, scan the same QR code from the app's pairing screen.

Without `HERMES_UI_URL` the pairing link points at `http://127.0.0.1:8787`, which only works on the
host itself.

### Tailscale

Set `HERMES_UI_REMOTE=tailscale-funnel` (or `tailscale-serve`). The backend runs its own userspace
`tailscaled` with state in `data/tailscale/`. Log in once through the URL it prints, or provide
`TS_AUTHKEY`. `TS_HOSTNAME` sets the machine name (default `hermes-ui`). Pair devices from the host as
above; they get a device cookie.

## Own iroh relay

By default clients meet the gateway through n0's public iroh relays. They cannot read your traffic
but see endpoint ids, IP addresses and timing. To use your own relay, deploy `iroh-relay` (see the
[iroh-bridge relay guide](https://github.com/irohkit/iroh-bridge/blob/main/deploy/relay/README.md))
and set:

```bash
IROH_RELAY_URL=https://relay.example.com
IROH_RELAY_TOKEN=…   # if your relay requires one
```

The relay URL is part of every new pairing link, so clients pick it up when they pair.

## Hosting the static UI

The UI holds no data and no secrets. It is built with relative asset paths, so it works under any path.

- **Any static host:** run `npm run build` and upload `web/dist/`. Serve it over HTTPS: service
  workers, Web Push and installation as a PWA need a secure context.
- **GitHub Pages from a fork:** fork the repository, then in the fork's settings choose
  Pages → Source → "GitHub Actions". `.github/workflows/pages.yml` builds `web/` on every push to
  `main` that touches `web/`, `shared/` or `site/`, and copies the static pages from `site/` next to it.
  Your UI URL is `https://<user>.github.io/<repo>/`.
- **Only locally:** leave `HERMES_UI_SERVE_UI=on` (the default); the backend serves `web/dist` itself.

Set `HERMES_UI_URL` to the URL you chose. Building and testing the UI itself: [development.md](development.md).

## Autostart

### macOS (LaunchAgent)

```bash
node server/scripts/launchd-plist.mjs --remote iroh > ~/Library/LaunchAgents/io.github.hermes-ui.plist
launchctl load ~/Library/LaunchAgents/io.github.hermes-ui.plist
```

The script prints a plist with this machine's paths and passes extra arguments to `hermes-ui serve`.
It starts at login, restarts on exit and logs to `~/Library/Logs/hermes-ui.log`. Run `npm run build`
once before, because `serve` does not build the UI. `server/examples/io.github.hermes-ui.plist` shows
the shape.

### Linux (systemd user unit)

`~/.config/systemd/user/hermes-ui.service`:

```ini
[Unit]
Description=Hermes UI backend
After=network-online.target

[Service]
WorkingDirectory=%h/hermes-ui
ExecStart=/usr/bin/env node bin/hermes-ui.mjs serve --remote iroh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
npm run build                                  # once, and after every update
systemctl --user daemon-reload
systemctl --user enable --now hermes-ui
loginctl enable-linger "$USER"                 # optional: keep running without a login session
journalctl --user -u hermes-ui -f              # logs
```

Make sure `node` on the unit's `PATH` is version 24 or newer; otherwise put its absolute path in
`ExecStart`. The backend reads `.env` from the repository root, so the unit needs no secrets.

## Updating

```bash
git pull
npm install
npm run build
# then restart: launchctl kickstart -k gui/$(id -u)/io.github.hermes-ui   or   systemctl --user restart hermes-ui
```

`data/` and `.env` stay as they are, so the iroh endpoint id and all paired devices survive an
update. The `iroh-gateway` version is pinned (`IROH_GATEWAY_VERSION`); a new pin downloads the new
binary on the next start. Browsers pick up a new UI on their next load; an installed PWA may need to
be closed and reopened once so the new service worker takes over.

## Backups

Everything that matters lives in `.env` and `data/`. The gateway key in `data/iroh/` is what keeps your
endpoint id; losing it means pairing every device again. What to back up, how to restore it and how
to move to a new machine: [secrets-and-state.md](secrets-and-state.md).
