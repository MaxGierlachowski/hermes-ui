# Decision records

Short records of decisions that shaped Hermes UI. Each one has the same parts: Context, Decision,
Consequences, Alternatives considered. A record is not edited when a decision changes; a new record
supersedes it and says so.

| # | Decision | Status |
|---|---|---|
| [0001](0001-iroh-instead-of-tunnels.md) | iroh for remote access instead of tunnels | Accepted |
| [0002](0002-paseo-integration-read-only.md) | Paseo integration is read-only (except answering permissions) | Accepted |
| [0003](0003-native-app-expo-with-native-iroh.md) | Native mobile app with Expo and a native iroh client (UniFFI) | Accepted |
| [0004](0004-tauri-option.md) | Tauri 2 as an option for desktop or a universal app | Open (see 0012) |
| [0005](0005-headless-backend-standalone-ui.md) | Headless backend and a standalone static UI | Accepted |
| [0006](0006-hermes-gateway-websocket.md) | Talk to Hermes through the gateway WebSocket, read `state.db` read-only | Accepted |
| [0007](0007-done-only-by-user.md) | Only the user moves interactive chats to Done | Accepted |
| [0008](0008-background-delivery-keepalive-and-fcm.md) | Android background delivery: keep-alive service plus optional FCM | Accepted |
| [0009](0009-offline-cache-swr.md) | Stale-while-revalidate cache in the mobile app | Accepted |
| [0010](0010-inbox-done-rule.md) | A chat is done only when its own Paseo agents are done too | Accepted |
| [0011](0011-touch-sizing-desktop-unchanged.md) | Touch sizing inside the base components, desktop pixel-identical | Accepted |
| [0012](0012-universal-app.md) | One codebase for phone, web and desktop (spike result, measurements, parity) | Proposed |
| [0013](0013-hermes-child-agents.md) | Hermes' own subagents and terminal `hermes chat` runs shown like Paseo agents | Proposed |
| [0014](0014-automations-in-the-inbox.md) | Cron runs, webhook runs and script messages in the inbox | Accepted |

## Adding a record

1. Copy the structure of an existing record into `NNNN-short-title.md` with the next free number.
2. Set the status: Proposed, Accepted, Open, or Superseded by NNNN.
3. Add a row to the table above.

See also: [architecture.md](../architecture.md), [security.md](../security.md).
