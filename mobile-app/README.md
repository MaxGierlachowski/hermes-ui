# Hermes UI – mobile app (Android/iOS)

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
  from [`../shared`](../shared), which the web UI uses too.

## What works

| Area | Status |
|---|---|
| Pairing: QR scan, deep link, pasted link; identity in the keystore | ✅ |
| Board: the columns as a swipe pager (tabs follow the finger, counts, last column remembered), live status dots, Paseo chips, pull to refresh, live via SSE | ✅ |
| Thread: Markdown, streaming replies, tool chips, event cards, inline Paseo cards, images with pinch-zoom lightbox, audio; videos only by name for now (playing them needs `expo-video`) | ✅ |
| Composer: text, gallery / camera images, voice messages, send / stop, above the keyboard | ✅ |
| Inbox: open approvals and clarify questions (answer in place), Paseo permissions, history | ✅ |
| New chat, search, Paseo agents + read-only transcripts, settings (path, theme, board, notifications) | ✅ |
| Share sheet "Share → Hermes UI" (text, image) starts a new chat | ✅ (Android) |
| Hardware back (closes lightbox / sheets first), haptics, edge-to-edge system bars in theme colours | ✅ |
| Cache: board, inbox, newest messages per chat, Paseo transcripts and images on the device; shown at once, refreshed in the background (progress bar), last state offline | ✅ |
| Notifications while the app runs; in the background via a keep-alive foreground service (Android) | ✅ |
| Push with the app closed (FCM) | prepared, needs a Firebase project (below) |
| iOS | Swift module + XCFramework; the app runs in the simulator (pairing, board, threads, direct path 2 ms). No device / TestFlight build (needs an Apple account) |

## Build (Android)

Requirements: Node 24, JDK 17, Android SDK + NDK (r27+), Rust via rustup with
`rustup target add aarch64-linux-android x86_64-linux-android`, and `cargo install cargo-ndk`.

```bash
cd mobile-app
npm install
npm run iroh:android              # Rust → libhermes_iroh.so (arm64-v8a, x86_64) + Kotlin bindings
npx expo prebuild --platform android
npm run apk                       # android/app/build/outputs/apk/release/app-<abi>-release.apk
```

Release signing uses a local keystore that is **never committed** (`mobile-app/.secrets/` is git-ignored):

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

Without that file the release APK is signed with the debug key (fine for trying it out). Keep the keystore:
an update must be signed with the same key, or Android refuses to install it over the old app.

Development: `npx expo run:android` (debug build + Metro). `EXPO_PUBLIC_E2E_TEST=1 npx expo start`
marks chats created by test runs as `TEST · …`, as `hk_e2e_test` does in the web UI.

Configuration through the environment at build time (`app.config.ts`): `HERMES_UI_ANDROID_PACKAGE`,
`HERMES_UI_IOS_BUNDLE_ID`, `HERMES_UI_LINK_HOST` / `HERMES_UI_LINK_PATH` (which `https` pairing links
the app offers to open), `HERMES_UI_ABIS`, `GOOGLE_SERVICES_JSON`.

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
   turns and new approvals arrive as notifications.
2. **FCM (closed app, no ongoing notification):** create a Firebase project with an Android app for the
   package name, then
   - build the app with `GOOGLE_SERVICES_JSON=/path/to/google-services.json`,
   - start the backend with `HERMES_UI_FCM_SERVICE_ACCOUNT=/path/to/service-account.json` (Firebase →
     Project settings → Service accounts → Generate new private key),
   - in the app: Settings → "Enable push (FCM)". The backend then sends to FCM (HTTP v1) everything it
     sends as Web Push, with the same per-device settings.

## iOS

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run iroh:ios                  # HermesIrohFFI.xcframework + Swift bindings
npx expo prebuild --platform ios && (cd ios && pod install)
npx expo run:ios                  # simulator
```

Build for the simulator with a local ad-hoc signature (the default); with `CODE_SIGNING_ALLOWED=NO`
the keychain refuses `expo-secure-store` ("A required entitlement isn't present").

`build-ios.sh` compiles against a patched copy of `libc` (`scripts/ios-patches.py`): current libc
hides `net/route.h` constants on iOS that iroh's `netwatch` needs. A device build, TestFlight and push
(APNs) need an Apple developer account.

## Tests

- `npm run iroh:test` with `HERMES_IROH_ENDPOINT`, `HERMES_IROH_PAIR` (and optionally
  `HERMES_IROH_RELAY`, `HERMES_IROH_KEY_FILE`): pairs the Rust client with a running backend, then
  requests, latency, the SSE stream and the connection path.
- `npm run typecheck`
