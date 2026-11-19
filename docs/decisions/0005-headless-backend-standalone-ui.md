# 0005: Headless backend and a standalone static UI

- **Status:** Accepted
- **Date:** 2026-11

## Context

The first version was one Node server that served a page and its API together. Remote access through
iroh changed the picture: a phone needs a UI it can load from somewhere public, but the API and all
data must stay on the host. The project should also be usable by others, so nothing in it may depend
on one person's machine.

## Decision

- **Backend** (`hermes-ui serve`): API and live stream on `127.0.0.1` only. Serving the UI is optional
  (`HERMES_UI_SERVE_UI=off` makes it headless). Remote access starts as a child process. Every setting
  comes from flags, environment, `.env` or defaults; no fixed paths.
- **UI** (`web/dist`): a static PWA built with relative asset paths, so it runs under any path and on
  any static host. It contains no data and no secrets.
- The UI decides at start-up where its backend is: a pairing fragment in the URL, a backend on its own
  origin (local mode), a remembered endpoint, or else a "scan or paste a pairing link" screen.
- One hosted copy of the UI (for example on GitHub Pages) can serve any number of backends; each
  device learns its backend from its own pairing link.

## Consequences

- The same build works locally (served by the backend) and remotely (served by any static host).
- Hosting the UI publicly leaks nothing: the pairing data lives in the URL fragment, which browsers do
  not send to servers.
- A UI update means rebuilding and re-hosting `web/dist`; the backend update is separate.
- The CLI gained `pair`, `status` and `install-gateway` next to `serve`.
- The native app ([ADR 0003](0003-native-app-expo-with-native-iroh.md)) fits the same model: one more
  client of the same API.

## Alternatives considered

- **Keep one server for UI and API, and tunnel both:** simpler, but every remote mode would have to
  carry the UI, and iroh would need the UI to come from the host.
- **Bundle the UI into the backend only:** blocks hosting it elsewhere and ties UI releases to backend
  restarts.
