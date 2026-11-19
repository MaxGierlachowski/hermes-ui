# 0004: Tauri 2 as an option (desktop and universal app)

- **Status:** Open, under evaluation
- **Date:** 2026-11

## Context

Tauri 2 came up twice.

1. **As a mobile framework**, in the comparison that led to [ADR 0003](0003-native-app-expo-with-native-iroh.md).
   Tauri 2 Mobile would run iroh in Rust directly in the app core, with no FFI layer, and reuse the web
   UI almost entirely. But its UI is the system WebView, and a WebView-based app was ruled out for
   mobile. Its mobile plugin ecosystem was also younger than Expo's.
2. **As a desktop shell.** A follow-up idea is one Expo codebase for iOS, Android and the web
   (through react-native-web), with the web build packaged by Tauri 2 as a desktop app. A Tauri app
   could also start the backend as a sidecar, so a single desktop app would contain everything. The
   goal stated for that idea is behaviour and speed like a good native app, not platform-native
   widgets.

## Decision

Not decided yet.

- For **mobile**, Tauri 2 was not chosen (see ADR 0003).
- For **desktop**, a spike was proposed to measure whether a Tauri-wrapped Expo web build can match
  the current shadcn web UI in features and feel: keyboard control, text selection, scrolling,
  drag and drop, split view, window chrome, tray and notifications.

The repository contains no Tauri code today. The existing web UI (`web/`) stays the desktop and
browser client until a replacement is at least equal.

## Consequences

- Nothing changes for users now.
- If the spike succeeds, the web UI could later be retired in favour of one shared UI. That would be
  recorded in a new ADR that supersedes this one.
- If it fails, `web/` stays, and `mobile-app/` stays mobile only.

## Alternatives considered

- **Keep separate UIs** (shadcn web + native app): the current state. Costs duplicate UI work but has
  no known quality gaps.
- **Tauri 2 Mobile for phones:** evaluated and not chosen (ADR 0003).
