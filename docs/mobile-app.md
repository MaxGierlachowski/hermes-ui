# Mobile app (Android / iOS)

The app in [`mobile-app/`](../mobile-app). Related: [releasing.md](releasing.md) ·
[development.md](development.md) · [architecture.md](architecture.md) · [security.md](security.md).

A React Native app (Expo SDK 58, New Architecture, Expo Router) for the hermes-ui backend. It is not a
WebView wrapper: the screens are native, and the connection to the backend is a **native iroh client**
(`modules/expo-iroh`, Rust through UniFFI) that speaks the same protocol as the browser's `iroh-fetch`.
The backend and its `iroh-gateway` stay unchanged.

```
 Phone (Android / iOS)                                     your machine
┌─────────────────────────────────────────────┐          ┌───────────────────────────────────────┐
│ React Native screens (NativeWind)           │          │ iroh-gateway ──HTTP──▶ hermes-ui       │
│  board · thread · composer · inbox · …      │          │  (allow-list of        backend         │
│        │ fetch-like API, SSE, downloads     │  QUIC    │   paired devices)      127.0.0.1:8787  │
│ expo-iroh (Kotlin / Swift)                  │◀────────▶│                                       │
│  └─ libhermes_iroh (Rust, UniFFI)           │ direct   └───────────────────────────────────────┘
│      iroh-bridge client-core v0.6.3         │ UDP, or
│      iroh 1.4.1, native preset (UDP)        │ via relay
└─────────────────────────────────────────────┘
```

- **Direct paths.** The browser build can only use a relay; the native client hole-punches a direct UDP
  path to the gateway and uses the relay only until then (measured on a LAN: 3–4 ms RTT direct).
- **Stable identity.** The device's iroh secret key lives in the platform keystore (`expo-secure-store`:
  Android Keystore / iOS Keychain), so the gateway's allow-list keeps recognising the device.
- **Same pairing links** as the web UI: scan the QR code of `hermes-ui pair`, open
  `hermesui://pair?iroh=…&relay=…&pair=…`, open the `https://<ui>/#iroh=…` link, or paste it.
- **Shared code.** Types, the SSE parser, pairing links, media-tag rules and the English texts come
  from [`shared/`](../shared), which the web UI uses too.

## What works

| Area | Status |
|---|---|
| Pairing: QR scan, deep link, pasted link; identity in the keystore | ✅ |
| Board: the columns as a swipe pager (tabs follow the finger, counts, last column remembered), live status dots, Paseo chips, pull to refresh, live via SSE | ✅ |
| Thread: Markdown, streaming replies, tool chips, event cards, inline Paseo cards, images with pinch-zoom lightbox, audio | ✅ |
| Composer: text, gallery / camera images, voice messages, send / stop, above the keyboard | ✅ |
| Inbox: open approvals and clarify questions (answer in place), Paseo permissions, history | ✅ |
| New chat, search, Paseo agents + read-only transcripts, settings (path, theme, board, notifications) | ✅ |
| Share sheet "Share → Hermes UI" (text, image) starts a new chat | ✅ (Android) |
| Hardware back (closes lightbox / sheets first), haptics, edge-to-edge system bars in theme colours | ✅ |
| Cache: board, inbox, newest messages per chat, Paseo transcripts and images on the device; shown at once, refreshed in the background (progress bar), last state offline | ✅ |
| Notifications while the app runs; in the background via a keep-alive foreground service (Android) | ✅ |
| Push with the app closed (FCM) | prepared, needs a Firebase project (below) |
| Demo mode: "Try the demo" on the pairing screen, sample data with streamed replies, no backend | ✅ |
| iOS | Swift module + XCFramework; the app runs in the simulator (pairing, board, threads, direct path 2 ms). No device / TestFlight build (needs an Apple account) |

## Build (Android)

Requirements (all installed / checked by `scripts/bootstrap.sh --mobile`, versions in
[development.md](development.md)): Node 24, JDK 17, Android SDK (platform 37, build-tools 37), NDK
27.1 (React Native) and 28.2 (iroh library), Rust from `rust-toolchain.toml` via rustup, `cargo-ndk`.

```bash
cd mobile-app
npm ci
npm run release:android     # iroh library → prebuild → AAB + one APK per ABI in dist/
```

Step by step: `npm run iroh:android` (Rust → `libhermes_iroh.so` + Kotlin bindings), `npx expo prebuild
--platform android --clean`, `npm run aab` / `npm run apk`. Development: `npx expo run:android` (debug
build + Metro). `EXPO_PUBLIC_E2E_TEST=1 npx expo start` marks chats created by test runs as `TEST · …`.

There is no universal APK: prebuilt AARs carry 32-bit libraries without the iroh library. Install the
APK for the phone's ABI (`arm64-v8a` for every current phone, `x86_64` for emulators).

### Signing

Release builds are signed with a local keystore that is **never committed** (`mobile-app/.secrets/`
is git-ignored). It is the Play **upload key** ([releasing.md](releasing.md)). Create one once:

```bash
mkdir -p .secrets && keytool -genkeypair -storetype PKCS12 -keystore .secrets/release.keystore \
  -alias hermes-ui -keyalg RSA -keysize 4096 -validity 10000
cat > .secrets/keystore.properties <<EOF
storeFile=/absolute/path/to/mobile-app/.secrets/release.keystore
storePassword=…
keyAlias=hermes-ui
keyPassword=…
EOF
```

Or point `HERMES_UI_KEYSTORE_PROPERTIES` at a properties file elsewhere. Without one the release build
is debug-signed (fine for trying it out, refused by Play). **Back it up**
([secrets-and-state.md](secrets-and-state.md)): an update installs over the existing app only with the
same key.

### Configuration

Build-time settings come from `mobile-app/.env` (see [`.env.example`](../mobile-app/.env.example)):
app name and id, URL scheme, pairing-link hosts, Apple team id, EAS project id, ABIs, foreground-service
type, Firebase files. Version and build number: [`version.json`](../mobile-app/version.json).

## Web and desktop builds

The same app builds for the web (`npm run web`, `npm run web:export`) and runs in the desktop app
([desktop-app.md](desktop-app.md)). Where a native module has no web version, a `*.web.ts(x)` file next to
the native one takes its place, with the same exports; Metro picks it for the web build, TypeScript checks
both:

| Native | Web / desktop |
|---|---|
| `lib/transport.ts` (expo-iroh) | `lib/transport.web.ts` (HTTP to 127.0.0.1 with the token, or iroh-fetch WASM) |
| `lib/cache.ts` (files) | `lib/cache.web.ts` (IndexedDB) |
| `lib/media.ts`, `lib/upload.ts` | `lib/media.web.ts`, `lib/upload.web.ts` |
| `lib/notify.ts`, `lib/haptics.ts`, `lib/keepalive.ts` | `.web.ts` (Tauri notifications / Notification API, no-ops) |
| `lib/desktop.ts`, `lib/web-input.ts` (no-ops) | `.web.ts` (Tauri bridge; keyboard, paste / drop, drag & drop, resize) |
| `components/Pager.tsx`, `PlatformShell.tsx`, `thread/ThreadList.tsx` | `.web.tsx` (scroll snap; shell; a natively scrolling thread) |

The layout follows the window width (`lib/nav.ts`): phone (< 700), tablet (two columns), desktop (≥ 1024:
four columns, chat in a split pane). The web export uses one bundle (`asyncRoutes` off) and tree shaking;
`public/vendor/` (iroh-fetch for the browser) is copied by `scripts/web-vendor.mjs`.

## Demo mode

`/demo?long=450` (web) or `hermesui://demo?long=450` adds a chat with 450 messages for measurements.

"Try the demo" on the pairing screen starts the app without a backend. `src/lib/demo.ts` stands in for
the iroh connection: it answers the same API paths and sends the same live events, from made-up sample
data in English or German (board with all columns, a thread with tool calls, an image and a Paseo
agent, an approval and a question in the inbox, search). Sending a message plays a streamed reply,
answering an approval continues the chat. Nothing is stored in the keystore and nothing leaves the
device; "Demo · exit" in the header (or Settings) returns to pairing. App reviewers use it
([`store/review-notes.md`](../store/review-notes.md)), and the store screenshots come from it.

## Cache

`src/lib/cache.ts` keeps what the screens showed last as small JSON files in the app's documents
directory: the board, the inbox, the newest 80 messages of the 40 most recent chats and of 20 Paseo
transcripts. Screens render from it in their first frame and refresh in the background; live events
update it directly. Images and audio are cached separately (`connection.ts`, at most 200 MB, oldest
first). "Forget pairing" deletes both.

## Push with the app closed (FCM)

Android stops a backgrounded app within seconds (cached-app freezer), so the live stream cannot deliver
then. Two ways around it:

1. **Keep-alive (built in, no account):** Settings → "Stay connected in the background". While Hermes
   works on a chat (default) or always, a quiet ongoing notification keeps the app running; finished
   turns and new approvals arrive as notifications. It is a foreground service of type `dataSync`
   (Android 15+ allows 6 h per 24 h; the service then stops and starts again with the next app start);
   `HERMES_UI_FGS_TYPE` selects `remoteMessaging` or `specialUse` instead
   ([releasing.md](releasing.md#foreground-service-android)).
2. **FCM (closed app, no ongoing notification):** create a Firebase project with an Android app for the
   package name, then
   - build the app with `GOOGLE_SERVICES_JSON=/path/to/google-services.json` (in `mobile-app/.env`),
   - start the backend with `HERMES_UI_FCM_SERVICE_ACCOUNT=/path/to/service-account.json` (Firebase →
     Project settings → Service accounts → Generate new private key),
   - in the app: Settings → "Enable push (FCM)". The backend then sends to FCM (HTTP v1) everything it
     sends as Web Push, with the same per-device settings.

## iOS

```bash
npm run iroh:ios                  # HermesIrohFFI.xcframework + Swift bindings (device + simulator)
npx expo prebuild --platform ios --clean && (cd ios && pod install)
npx expo run:ios                  # simulator (dev client)
```

Build for the simulator with a local ad-hoc signature (the default); with `CODE_SIGNING_ALLOWED=NO`
the keychain refuses `expo-secure-store` ("A required entitlement isn't present").

`build-ios.sh` compiles against a patched copy of `libc` (`scripts/ios-patches.py`): current libc
hides `net/route.h` constants on iOS that iroh's `netwatch` needs.

Store-relevant settings in `app.config.ts`: privacy manifest (required-reason APIs: UserDefaults,
file timestamps, system boot time, disk space; no data collected, no tracking), usage texts for camera,
microphone, photos and local network, `ITSAppUsesNonExemptEncryption`, no background audio mode, no
Face ID. A device build, TestFlight and push (APNs) need an Apple developer account
([releasing.md](releasing.md)).

## Tests

- `npm run iroh:test` with `HERMES_IROH_ENDPOINT`, `HERMES_IROH_PAIR` (and optionally
  `HERMES_IROH_RELAY`, `HERMES_IROH_KEY_FILE`): pairs the Rust client with a running backend, then
  requests, latency, the SSE stream and the connection path.
- `npm run typecheck`
