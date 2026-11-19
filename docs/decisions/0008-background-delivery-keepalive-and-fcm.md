# 0008: Background delivery in the Android app: keep-alive service plus optional FCM

- **Status:** Accepted
- **Date:** 2026-11

## Context

The native app gets its updates from the backend's live event stream over iroh. On recent Android
versions the cached-app freezer stops a backgrounded app within seconds. After that nothing arrives:
in a test the backend created the inbox entry, but the frozen app never saw it.

A native app has no service worker, so Web Push is not available. The usual answer is Firebase Cloud
Messaging, which needs a Firebase project, a `google-services.json` in the app build and a service
account on the backend. A self-hosted tool should also work without any account.

## Decision

Offer two mechanisms that can be used together:

1. **Keep-alive (built in, no account).** A foreground service of type `remoteMessaging` with a quiet
   ongoing notification keeps the process and the connection alive.
   - Default mode "while Hermes works": the service starts while a chat runs (it may only start from
     the foreground, as Android requires) and stops 30 s after the last turn ends.
   - Other modes: "always" (more battery) and "off".
   - Finished turns and new approvals arrive as local notifications; a tap opens the thread.
2. **FCM (optional).** The app registers its FCM token at `POST /api/push/native`. The backend
   (`server/src/push-fcm.mjs`) sends through the FCM HTTP v1 API with a self-signed OAuth JWT, no extra
   dependency, and uses the same per-device settings as Web Push. It is enabled only when the app is
   built with `GOOGLE_SERVICES_JSON` and the backend has `HERMES_UI_FCM_SERVICE_ACCOUNT`.

## Consequences

- Without any account, notifications work while Hermes is busy, which is when they matter most.
- With FCM, notifications also arrive when the app is fully closed and no ongoing notification is
  shown.
- FCM messages are not end-to-end encrypted; Google sees the chat title and the kind
  ([security.md](../security.md#what-passes-through-relays-and-third-parties)).
- A foreground service needs a store declaration on Google Play.
- iOS push needs APNs and an Apple developer account; not built yet.

## Alternatives considered

- **FCM only:** forces every user to create a Firebase project.
- **Keep-alive only:** costs battery when set to "always" and shows a permanent notification.
- **Periodic background fetch:** too infrequent and unreliable for approvals with short timeouts.
