# 0009: Stale-while-revalidate cache in the mobile app

- **Status:** Accepted
- **Date:** 2026-11

## Context

The first native build fetched everything on every screen. Opening the app showed a blank board until
the iroh connection was up and `/api/sessions` had answered (0.8–1.3 s on a LAN, more over a relay or
mobile data). Opening a chat showed an empty screen while it loaded. Without a connection the app
showed only an error page.

## Decision

- Keep what the screens showed last in a persistent cache (`app/src/lib/cache.ts`): small JSON
  files in the app's documents directory, read synchronously so the first frame already has content.
  - board and inbox,
  - the newest 80 messages of the 40 most recently opened chats,
  - 20 Paseo transcripts and the agent lists.
- Cache images and audio on disk, at most 200 MB, oldest first out. Remember aspect ratios so nothing
  jumps.
- Show the cache at once, refresh in the background, and show a thin progress bar under the header
  only when a refresh takes longer than 150 ms.
- Apply live events directly to the cache, also for chats that are not open. Debounce writes.
- Offline: show the last state with "Offline, as of …" and retry every 15 s and when the app returns
  to the foreground.
- "Forget pairing" deletes the cache and the media.

## Consequences

- Measured in an emulator: cold start to a visible board went from about 1.6 s to about 0.6 s; opening
  a chat from about 480 ms to about 270 ms (part of that is a shorter transition animation).
- The app is usable read-only without a connection.
- Cached chat content sits on the device, inside the app sandbox.
- The backend still sends the full history of a chat on every request; a paged endpoint would help on
  slow networks and is open.

## Alternatives considered

- **TanStack Query with a persister on MMKV or SQLite:** more machinery than needed; the data shapes
  are few and already flow through one store.
- **No cache, faster fetches only:** cannot help offline or on a cold relay connection.
