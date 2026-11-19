# 0001: iroh for remote access instead of tunnels

- **Status:** Accepted
- **Date:** 2026-11

## Context

The backend binds to `127.0.0.1` and should stay that way. People still want to use the board from a
phone or tablet, also away from home. The requirements were:

- starts together with the backend, with no extra setup step,
- works in a mobile browser without installing anything,
- private: only devices the owner approved can connect,
- free, and ideally without an account.

Options evaluated: Cloudflare quick tunnels, Cloudflare named tunnels with Access, Tailscale Funnel
and Serve, ngrok, and iroh.

An early assessment rejected iroh because browsers cannot speak it. That was wrong: iroh runs in the
browser as WASM (relay-only), and [iroh-bridge](https://github.com/irohkit/iroh-bridge) (MIT) provides
both halves: `iroh-gateway` next to the backend, and `iroh-fetch` in the browser, which sends
`fetch`, `EventSource` and uploads for a virtual origin over iroh.

## Decision

Use iroh as the recommended remote mode (`HERMES_UI_REMOTE=iroh`):

- The backend runs `iroh-gateway` as a child process. It downloads a pinned release once and checks
  its SHA-256.
- The UI is a static PWA that dials the gateway's endpoint id through a relay.
- The gateway admits only paired endpoint ids (allow-list, hot-reloaded). The backend checks the
  verified id again on every request.
- Pairing uses a one-time code in the URL fragment of a QR link.

Keep the tunnel modes as alternatives: `tailscale-funnel` (stable HTTPS address),
`tailscale-serve` (tailnet only) and `cloudflare` (fallback, no account).

## Consequences

- No account, no open port, end-to-end encryption between device and gateway.
- An unpaired device is refused at connection time, before any HTTP request.
- The UI must be hosted somewhere static once (for example GitHub Pages).
- Browsers always go through a relay (measured over a public relay: about 60 ms median, 110 ms p90
  API latency). The native app can use a direct path.
- The WASM bundle is about 1.4 MB gzipped. It loads only in remote mode.
- Reachability depends on the public n0 relays unless you run your own (`IROH_RELAY_URL`).
- iroh-bridge was a very young project when this was decided. The version is pinned and the code is
  MIT, so it can be forked if needed.

## Alternatives considered

- **Cloudflare quick tunnel:** no account, but a new URL on every start, no SLA, and Cloudflare
  documents no SSE support for quick tunnels. Kept as a fallback only.
- **Cloudflare named tunnel + Access:** strong identity in front of the origin, but needs a Cloudflare
  account and an own domain. Too heavy as a default for a self-hosted tool.
- **Tailscale Funnel / Serve:** stable addresses and good privacy (Serve), but needs a Tailscale
  account, and Serve needs the Tailscale app on the phone. Kept as modes.
- **ngrok:** needs an account; the free plan limits sessions and static domains.
- **Own Rust/wasm-bindgen bridge:** not needed once iroh-bridge proved to carry the full feature set.
