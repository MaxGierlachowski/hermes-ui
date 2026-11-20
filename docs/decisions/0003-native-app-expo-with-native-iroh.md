# 0003: Native mobile app with Expo and a native iroh client

- **Status:** Accepted
- **Date:** 2026-11

## Context

The web UI works on phones as an installed PWA, but some limits remain: the connection always goes
through a relay, Web Push on iOS works only for Home Screen apps, and keyboard, gestures and scrolling
in a browser never quite feel native.

The first plan was a thin Expo shell around a WebView that loads the existing web UI, with native
extras (QR scanner, push, share intent) bridged over `postMessage`. Before it was built, the
maintainer asked for a real native app instead: "not just a WebView wrapper", with native modules for
iroh.

The hard part is the connection. `iroh-fetch` runs as WASM in browsers or as a Node addon. React
Native's JavaScript engine supports neither.

## Decision

- Build `app/` as a React Native app with Expo (SDK 58, New Architecture, Expo Router) and
  native screens styled with NativeWind, using the web UI's colour tokens.
- Write the connection as an Expo module, `modules/expo-iroh`: a thin Rust crate around iroh-bridge's
  own client (`client-core`, the same client inside `iroh-fetch`), exposed with **UniFFI** to Kotlin
  and Swift, and from there to JavaScript as a fetch-like API (streaming bodies, SSE, file downloads,
  connection info).
- Pin the client to the gateway's version, so the wire protocol is identical and the backend and
  `iroh-gateway` stay unchanged.
- Use iroh's native preset: real UDP with hole-punching; the relay only to start and as a fallback.
- Keep the device's secret key in the platform keystore through `expo-secure-store`.
- Move shared logic (types, SSE parser, pairing links, media-tag rules, English texts) into
  `shared/` instead of copying it.

## Consequences

- Direct paths: measured 3–4 ms RTT from an Android emulator to the host on a LAN, against about
  60 ms through a relay for the browser.
- Native gestures and transitions: board pager, sheets, pinch-zoom viewer, share intent, haptics,
  hardware back.
- Two UIs to maintain (web and app). Only logic in `shared/` is reused, not components.
- The build needs Rust, the Android NDK and `cargo-ndk`, and Xcode for iOS. The release APK is about
  55 MB per ABI (the iroh library is about 10 MB of it), so APKs are split per ABI.
- iOS needed a build-time patch: the current `libc` crate hides `net/route.h` constants on iOS that
  iroh's network monitoring uses. `scripts/ios-patches.py` patches a copy at build time.
- No Web Push in a native app. Background delivery uses a keep-alive service or FCM
  ([ADR 0008](0008-background-delivery-keepalive-and-fcm.md)).

## Alternatives considered

- **Expo + WebView wrapper:** the fastest path and full UI reuse, but it keeps the browser's limits
  and was explicitly not wanted. Discarded before it was built.
- **Capacitor:** the same WebView trade-off, and the iroh plugin would need the same UniFFI work.
- **Tauri 2 Mobile:** Rust in the app core without an FFI layer and full reuse of the web UI, but the
  UI is again a WebView. See [ADR 0004](0004-tauri-option.md).
- **Tailscale or Cloudflare inside the app:** would replace iroh with an account-based tunnel and lose
  the pairing model.
