# HANDOFF – Hermes UI (Stand 19.11.2026, Pause ~2 Wochen)

Persönliche Übergabe von Max an Max. Enthält **keine Secrets**, nur wo sie liegen und wie man sie mitnimmt.
Alles Technische steht ausführlich in `docs/` auf dem Branch `hermes/universal-spike` (siehe unten).

---

## 1. Was ist wo

| Was | Wo |
|---|---|
| Code | GitHub `MaxGierlachowski/hermes-ui` (öffentlich, MIT) |
| **Aktuellster Stand** | Branch **`hermes/universal-spike`** (enthält alles: Store-Vorbereitung + Universal-App + Umbenennung `mobile-app/` → `app/`) |
| Offene PRs | **#9** `hermes/mobile-app` → `main` (Store-Vorbereitung, Demo-Modus, Monorepo `server/`, Doku, Release-Tooling) · **#10** `hermes/universal-spike` → `hermes/mobile-app` (Universal-App iOS/Android/Web/Desktop mit Tauri 2, `app/`). Beide Draft, **Reihenfolge: erst #9, dann #10**. |
| `main` | Stand vor #9: alte shadcn-Web-UI in `web/`, Backend im Root, App noch in `mobile-app/` |
| Web-UI (PWA) live | https://maxgierlachowski.github.io/hermes-ui/ (aus `main`, GitHub Pages) |
| Releases (GitHub, Pre-Release) | `mobile-app-v0.3.0` (Android APK + AAB, Demo-Modus) · **`app-v0.4.0-beta`** (Android, UI-Polish; Update über 0.3.0, gleicher Schlüssel) · `desktop-spike-1` / `desktop-spike-2` / **`desktop-spike-3`** (macOS `.dmg`, unsigniert, Apple Silicon; spike-2 Permissions, spike-3 UI-Polish) |
| Doku (englisch) | `docs/` auf `hermes/universal-spike`: `architecture.md`, `development.md`, `app.md`, `desktop-app.md`, `releasing.md`, `secrets-and-state.md`, `security.md`, `self-hosting.md`, `configuration.md`, `design.md`, `mobile-audit.md`, `ui-audit.md`, `features.md`, `decisions/0001…0012` |
| Desktop-App auf diesem Mac | `/Applications/Hermes UI.app` = `desktop-spike-3` (installiert 19.11.); noch **nicht gekoppelt** (siehe Nächste Schritte) |
| Nur lokal (nicht gepusht, absichtlich) | Branch `archive/pre-publish` (alte Commits mit persönlichen Pfaden) – kann weg |

## 2. Stand

- **Backend** (`node bin/hermes-ui.mjs serve`): verbindet sich per WebSocket mit dem lokalen Hermes-Gateway, liest Paseo über paseo-mcp-Events, Fernzugriff über **iroh** (eigenes `iroh-gateway`, n0-Relays), Web Push (VAPID), Inbox, Approvals/Clarify.
- **Web-UI** (`web/`, shadcn): ausgereift, läuft produktiv.
- **App** (`app/`, Expo SDK 58, NativeWind + react-native-reusables, natives Modul `expo-iroh` in Rust/UniFFI): Android läuft auf dem Handy (direkte iroh-Verbindung ~3–4 ms im WLAN), iOS nur Simulator. Board-Pager, Cache/Offline, Demo-Modus, Share-Intent, Pinch-Zoom.
- **Universal (Weg B)**: dieselbe `app/` läuft als Web-Export und in **Tauri 2** als macOS-App (`desktop-app/`). Empfehlung im Spike: `web/` erst ablösen, wenn die Lücken geschlossen sind (`docs/decisions/0012-universal-app.md`).

## 3. Nächste Schritte (in dieser Reihenfolge)

1. PR #9 mergen, dann PR #10 mergen. Danach im Checkout mit dem echten Keystore die Umbenennung nachziehen (Abschnitt „After the rename“ in `docs/secrets-and-state.md`: `mobile-app/.secrets` → `app/.secrets`, `storeFile` anpassen, SHA-256 prüfen – muss gleich bleiben).
2. ~~UI-Polish der Universal-App auf shadcn-Niveau~~ **erledigt 19.11.** (PR #10, `desktop-spike-3`, `app-v0.4.0-beta`; Befunde, bewusste Abweichungen und Messwerte in `docs/ui-audit.md`, keine Performance-Regression). Noch offen: Desktop-App mit dem Backend auf 8787 koppeln (`hermes-ui pair` → Link einfügen, oder "Lokal verbinden" mit `HERMES_UI_TOKEN`); weißer Streifen links im Vollbild-Pairing-Screen prüfen; Inbox öffnet auf Android leicht gescrollt.
3. Lücken für die Ablösung von `web/` schließen (laut Spike; Syntax-Highlighting und Inbox-Filter sind inzwischen drin): Web Push in der Universal-App, Geräte-Kopplung für Fernzugriff im Web, Desktop-Header-Filter (Quelle, Zeitraum, Cron), Sprung zum Suchtreffer, Paseo-Deep-Link, PWA, Notification-Klick öffnet Chat. Danach `web/` entfernen.
4. Store (nur wenn gewünscht) – Entscheidungen und Schritte: `docs/releasing.md`. Offen: **App-ID** (endgültig, eigene Domain, z. B. `com.<domain>.<app>`), **Produktname** (eigener Name statt „Hermes …“, „for Hermes Agent“ nur im Untertitel), Foreground-Service `dataSync`, Frankreich vorerst ausschließen, 18+, Store-Build ohne Firebase, Anbieterdaten für Datenschutz/Support-Seite, Accounts (Apple 99 $/Jahr; Google Play 25 $, privat: 12 Tester × 14 Tage).
5. Idee (nicht begonnen): optionaler **Hub-Server** (Accounts, Push ohne wachen Mac, Offline-Queue, mehrere Rechner), Daten weiter E2E über iroh. Als ADR ausarbeiten.

## 4. Neuer Laptop – in dieser Reihenfolge

```bash
git clone git@github.com:MaxGierlachowski/hermes-ui.git && cd hermes-ui
git checkout hermes/universal-spike          # oder main, wenn #9/#10 gemergt sind
scripts/bootstrap.sh --mobile --yes          # Node, npm ci, iroh-gateway, Rust/cargo-ndk, Android SDK/NDK, JDK 17, Tests, Build
brew install age                             # für das Secrets-Archiv (sonst openssl)
scripts/import-secrets.sh ~/Downloads/hermes-ui-secrets-<datum>.tar.gz.age --list   # Inhalt ansehen
scripts/import-secrets.sh ~/Downloads/hermes-ui-secrets-<datum>.tar.gz.age          # wiederherstellen
node bin/hermes-ui.mjs serve                 # Backend (Port 8787), UI unter http://127.0.0.1:8787/
node bin/hermes-ui.mjs status                # iroh online? Endpoint-ID muss dieselbe sein wie vorher
```

Details: `docs/development.md` (Versionen, Layout, Befehle), `docs/app.md` (App bauen/signieren), `docs/desktop-app.md`.

**Wichtig – nur ein Backend pro Identität:** Das Archiv enthält die iroh-Identität (`data/iroh/`) und die gekoppelten Geräte. Läuft das Backend mit denselben Daten auf zwei Rechnern gleichzeitig, konkurrieren beide um dieselbe Endpoint-ID. Entweder auf dem alten Rechner stoppen (LaunchAgent `io.github.hermes-ui…` entladen) oder auf dem neuen ohne `data/` starten und Geräte neu koppeln.

Voraussetzungen außerhalb des Repos auf dem neuen Rechner: **Hermes Agent** (Gateway läuft, Backend liest `~/.hermes`) und optional **Paseo** + Plugin **paseo-mcp** (siehe 6).

## 5. Secrets – was, wo, wie mitnehmen

Nie in Git. Vollständige Liste und Erklärung: `docs/secrets-and-state.md`. Auf dem alten Rechner liegen sie im Checkout `~/Documents/Development/Repositories/hermes-ui/`:

| Datei | Warum wichtig |
|---|---|
| `mobile-app/.secrets/release.keystore` + `keystore.properties` | **Android-Signierschlüssel – nicht ersetzbar.** Ohne ihn keine Updates der installierten App und kein Play-Upload. |
| `.env` | `HERMES_UI_TOKEN` (lokaler Login) + Einstellungen |
| `data/iroh/` | iroh-Schlüssel = Endpoint-ID (Pairing-Links bleiben gültig) |
| `data/devices.json` | gekoppelte Geräte |
| `data/vapid.json`, `data/push.json` | Web-Push-Schlüssel + Abos |
| `data/board.json`, `data/inbox.json`, `data/media/` | Board-Zustand, Inbox-Verlauf, hochgeladene Medien |

**Backup erstellen (einmal, selbst ausführen – fragt nach einer Passphrase):**

```bash
brew install age
cd ~/Documents/Development/Repositories/hermes-ui-universal
scripts/export-secrets.sh --root ~/Documents/Development/Repositories/hermes-ui \
  -o ~/Desktop/hermes-ui-secrets-$(date +%Y%m%d).tar.gz.age
```

- Archiv an **zwei Orten** ablegen (z. B. iCloud/Drive + USB), **Passphrase im Passwortmanager**, nicht neben dem Archiv.
- Zusätzlich empfohlen: `release.keystore` + `keystore.properties` direkt als Anhang im Passwortmanager.
- Ablageort hier notieren: `____________________________`

## 6. Hermes ↔ Paseo-Integration (Events), falls auf dem neuen Rechner gewünscht

Kein Teil dieses Repos, aber nötig, damit Hermes sofort von Paseo-Agents erfährt.

1. **paseo-mcp** (`MaxGierlachowski/paseo-mcp`, ≥ 0.4.0) als Paseo-Plugin aus Git installieren:
   `paseo plugin install https://github.com/MaxGierlachowski/paseo-mcp.git --ref main` (CLI: `/Applications/Paseo.app/Contents/Resources/bin/paseo`). Es schreibt den Launcher `~/.local/bin/paseo-mcp`.
2. Hermes-MCP-Eintrag auf den Launcher: `hermes config set mcp_servers.paseo.command ~/.local/bin/paseo-mcp` (+ `args: []`, env `PASEO_MCP_CONFIG` → `~/.config/paseo-mcp/config.json`), dann `/reload-mcp` in einem Hermes-Chat.
3. Webhook-Route in Hermes (Signatur `generic`, Events `agent.turn_ended,agent.permission_requested,webhook.test`, Filter-Script `wh_paseo_event.py`, `--deliver <platform> --deliver-chat-id "{route.chat_id}" --mirror-to-session`). Das Filter-Script verwirft Agents ohne `origin=hermes`, nimmt Chat/Thread aus den Labels `hermes_chat_id`/`hermes_thread_id` (Default: eigener Kanal) und reicht flache Felder (`view.*`) ans Prompt-Template. In `~/.hermes/webhook_subscriptions.json` zusätzlich `deliver_extra.thread_id = "{route.thread_id}"` setzen.
4. Im Paseo-Plugin (Settings → paseo-mcp) einen Webhook anlegen: URL `http://127.0.0.1:8644/webhooks/paseo-events`, Signatur „Standard Webhooks“, Secret = Secret der Hermes-Route, Filter `origin=hermes`, nur „needs attention“.
5. Hermes setzt beim Start eines Agents die Labels `origin_ref`, `hermes_chat_id`, `hermes_thread_id` (aus `HERMES_SESSION_*`), damit Events im richtigen Thread landen.

Ausführliche Doku: README von paseo-mcp (Abschnitt „Events“/„Webhooks“).

## 7. Stolpersteine

- Nach Merge von #9: Backend liegt in `server/`; einmal `npm ci` im Root, dann Backend neu starten.
- Desktop-App unsigniert: erster Start per Rechtsklick → Öffnen. macOS merkt sich Mikro/Kamera-Freigaben nur bei stabiler Signatur; neue unsignierte Builds können erneut fragen. Dauerhaft: Developer-ID-Signing + Notarization (`docs/releasing.md`).
- Android-Updates nur mit demselben Keystore **und** derselben App-ID. Ein Wechsel der App-ID (vor dem Store) heißt einmal neu installieren.
- „Hermes“ ist die Marke von Nous Research – für ein eigenes Produkt eigenen Namen wählen.
