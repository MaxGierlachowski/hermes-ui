# Desktop app (macOS, Tauri 2)

The app in [`desktop-app/`](../desktop-app). Related: [decisions/0012-universal-app.md](decisions/0012-universal-app.md) ·
[mobile-app.md](mobile-app.md) · [releasing.md](releasing.md#desktop-app-macos) · [security.md](security.md).

The desktop app is the universal app's web build (`mobile-app`, `expo export -p web`) in a Tauri 2
window, plus what a browser tab cannot do: a menu bar, a tray icon, a global shortcut, the macOS
Keychain, launch at login, and optionally the backend itself, so one app contains everything.

```
 Hermes UI.app
┌──────────────────────────────────────────────────────────────┐
│ WKWebView: universal app (web build)                          │
│   board · split chat · inbox · ⌘K       ── HTTP + token ──┐   │
│ Tauri shell (Rust)                                        │   │
│   menu · tray · ⌥⇧H · Keychain · notifications            ▼   │
│   sidecar: Contents/MacOS/node + resources/server ──▶ 127.0.0.1:8799
└──────────────────────────────────────────────────────────────┘
```

## Install (unsigned beta)

The DMG from the release is not signed or notarized yet. macOS refuses to open it with a double click:
**right-click the app → Open → Open**, once. (Or `xattr -dr com.apple.quarantine "/Applications/Hermes UI.app"`.)

## Connecting to a backend

On first start the app shows the pairing screen with four ways:

| Way | What happens |
|---|---|
| **Start built-in backend** | Starts the bundled backend (sidecar) on `127.0.0.1:8799` with its own data folder (`~/Library/Application Support/io.github.hermes-ui.desktop/backend`). Hermes must run on this Mac. The choice is remembered; the backend starts with the app and stops when you quit it. |
| **Backend on this machine** | URL + token of a backend that is already running (e.g. `http://127.0.0.1:8787` and `HERMES_UI_TOKEN` from its `.env`). Plain HTTP, no iroh. |
| **Pairing link** | `#iroh=…&relay=…&pair=…` from `hermes-ui pair`: the backend on another machine, over iroh (WASM, through the relay). |
| **Demo** | Sample data, no backend. |

The token and the pairing are kept in the macOS Keychain (service `io.github.hermes-ui.desktop`).
"Forget backend" in the settings removes them and stops the built-in backend.

## Keyboard and mouse

| | |
|---|---|
| ⌘K or `/` | Search and commands |
| ⌘N | New chat |
| ⌘1 … ⌘4 | Jump to a column |
| ↑ ↓ ← → (h j k l) | Move in the board; Enter opens |
| Esc | Close the topmost thing (menu, lightbox, dialog, then the chat) |
| ⌘B / ⌘I | Board / Inbox |
| ⌘, | Settings |
| Enter / ⇧Enter | Send / new line |
| ⌥⇧H (anywhere) | Show or hide the window |
| Right-click a card | Open, move to a column, copy title or id |
| Drag a card | Move it to another column |
| Drag the split line | Resize the chat |

Closing the window keeps the app in the tray (notifications keep coming); quit with ⌘Q or the tray menu.

## Configuration

`desktop.json` in `~/Library/Application Support/io.github.hermes-ui.desktop/` (written by the app; every
key also as an environment variable for development):

| Key | Env | Default | |
|---|---|---|---|
| `mode` | `HERMES_UI_DESKTOP_MODE` | `off` | `sidecar`, `connect` or `off` (pairing screen decides) |
| `port` | `HERMES_UI_DESKTOP_PORT` | `8799` | port of the built-in backend |
| `connectUrl`, `connectToken` | `HERMES_UI_DESKTOP_URL`, `_TOKEN` | – | `connect` mode |
| `sidecarArgs` | `HERMES_UI_DESKTOP_SIDECAR_ARGS` | `[]` | extra backend flags, e.g. `["--paseo", "off"]` |
| `dataDir` | `HERMES_UI_DESKTOP_DATA_DIR` | app data dir `/backend` | the built-in backend's state |
| `globalShortcut` | `HERMES_UI_DESKTOP_SHORTCUT` | `Alt+Shift+H` | empty = none |
| – | `HERMES_UI_DESKTOP_ROUTE` | – | open a route at start (e.g. `/demo`), for screenshots |

The built-in backend writes its log to `backend.log` in its data folder.

## Build

Needs Node 24, Rust (rustup) and Xcode's command line tools.

```bash
cd desktop-app
npm ci
npm run build     # web build of the app → dist-web, sidecar (esbuild bundle + node), tauri build
open "src-tauri/target/release/bundle/dmg/"
```

- `npm run web` exports the app (`mobile-app` → `dist-web`), `npm run sidecar` bundles `server/` with
  esbuild into `src-tauri/resources/server/hermes-ui.mjs` and copies the running Node binary to
  `src-tauri/binaries/node-<target>`. Both are build output (git-ignored).
- `npm run dev` runs the shell against the Expo web dev server (`npm --prefix ../mobile-app run web`, port 8081).
- The Node binary needs the JIT entitlement under the hardened runtime (`src-tauri/Entitlements.plist`);
  without it the sidecar dies at start with "Failed to reserve virtual memory for CodeRange".
- The bundle is Apple silicon only for now (`aarch64`); a universal binary needs
  `rustup target add x86_64-apple-darwin` and an x86_64 Node.

## Security notes

- The webview may call only the commands listed in `src-tauri/capabilities/default.json`; the CSP allows
  connections to `127.0.0.1`, HTTPS / WSS (iroh relays) and nothing else.
- The backend answers CORS only for `tauri://localhost` (and `HERMES_UI_CORS_ORIGINS`), and only with the
  Bearer token: no cookies across origins.
- The built-in backend listens on 127.0.0.1 only, like any hermes-ui backend. Other local processes can
  reach that port; the token is what protects it (see [security.md](security.md#known-limits)).
