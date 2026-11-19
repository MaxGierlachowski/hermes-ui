# Features

What the board, the thread panel and the inbox do, in detail. The mobile app: [app.md](app.md).


- **Board:** drag & drop (dnd-kit). On a phone it switches to tabs per column.
- **Column rules:**
  - Doing: Hermes is running a turn, or a Paseo agent the session owns is still running ("Paseo running (n)").
  - Waiting: the turn has finished and nothing of the session runs any more, or there is an open approval or clarify prompt.
  - Done: **only you** set it, and it sticks until you write in that session again.
  - Finished cron, webhook and one-shot runs go to Done; they are visible behind the "Cron/system" filter.
- **Thread panel:**
  - Full transcript with tool calls (collapsible) and images, live streaming, stop button.
  - Composer with text, images (paste or drag & drop) and voice messages. Voice is recorded with MediaRecorder and transcribed by Hermes' own STT.
- **Approvals and questions:** shown on the card and inline in the thread.
  - Approval: approve with the options Hermes offers (once / session / always) or deny.
  - Clarify: answer with buttons, multi-select or free text, or skip. A countdown shows when Hermes gives a time limit.
- **Paseo agents (optional; read-only except answering permissions from the inbox):**
  - The board finds a session's agents from the session's own `paseo_*` tool calls and shows them as chips with their live state.
  - The live state comes from [paseo-mcp](https://github.com/MaxGierlachowski/paseo-mcp) events (≥ 0.4.0): a subscription to the `paseo://agents` resource, with no polling. A direct daemon connection is the fallback. When the daemon is reachable it also provides richer transcripts and the app deep link.
  - The "Paseo agents" tab lists them; a transcript view shows each one read-only, updating live while the agent runs.
  - A deep link (`paseo://h/<server>/agent/<id>`) opens the agent in the Paseo app.
  - Images that agents reference by local path (`file:///…`, `/Users/…`) are served read-only by `/api/file`: image types only, only below the allowed roots (see `HERMES_UI_IMAGE_ROOTS`), checked on the real path. Missing files show a placeholder; a click opens a lightbox.
  - Files Hermes attaches to a reply with `MEDIA:<path>` (what Slack shows as attachments) appear under the message: images, audio players, other files by name. Only exactly those referenced files become readable, the tags never show up in the text, not even while streaming.
- **Tabs:** Board and Inbox, in the header on a desktop and as a bottom tab bar on a phone. The tab is part of the URL (`#/board`, `#/inbox`, `#/inbox/<session>`), so a reload or a link keeps it. `g b` / `g i` switch.
- **Inbox (across all chats):**
  - *Needs you:* every open Hermes approval and clarify question of every followed session, answerable in place with the same controls and countdown as in the thread, and every Paseo agent with a pending permission (agent, tool, command or description), answerable with Allow / Deny via paseo-mcp's `paseo_respond_permission`. Each entry names its chat and links to the thread.
  - *History:* requests and how they were answered (here, elsewhere, expired), finished chats, errors, Paseo agents that finished, failed or hit a usage limit. Read/unread, "mark all read", filters by kind and source, grouped by day. Stored in `<data-dir>/inbox.json` (30 days / 1000 entries by default).
  - A Hermes chat counts as *done* only when Hermes' turn is over **and** none of the Paseo agents it started or steers is still running or waiting for a permission (the same rule as the columns). A Paseo agent finishing is its own entry.
- **In-app notifications:** toasts for new requests and finished chats while the app is visible (a click opens the thread or the inbox), a badge on the Inbox tab and on the app icon (Badging API where available).
- **Push notifications (Web Push, see below).**
- **Search (⌘K, `/` or the search field):** full text over the titles and content of all chats, using Hermes' own FTS5 index (`messages_fts`, read-only; user and Hermes messages, no tool output). Results show title, source, column, last activity, message and Paseo-agent counts and a snippet with the hit marked; Enter opens the thread at the matching message. Archived chats on request. Also: new chat (N), theme, language, cron/system filter, remote access.
- **Light and dark mode**, English and German, a mobile layout, and installable as a PWA.
- **Phones and tablets:** every control is at least 44 × 44 px to hit (Apple HIG; checked by a test), fields use 16 px text so iOS does not zoom in, and nothing changes for a mouse.
  - The thread opens as a bottom sheet: drag it down to close. The composer is one row (attach · text · one round button that is the mic, send, or stop), Enter makes a new line, and it stays above the keyboard on iOS too.
  - Board: column tabs, swipe sideways to switch columns, long-press a card to move it. Column choice, new chat, notifications and remote access open as bottom sheets; search is full screen.
  - Images (thread, attachments, Paseo transcripts) open full screen: pinch or double-tap to zoom the image only (the app itself never zooms), drag to pan, swipe down to close.

## Push notifications

Standard Web Push with VAPID. The backend generates its key pair on first start (`<data-dir>/vapid.json`, never part of the repo) and sends outgoing HTTPS requests to whatever push service the browser uses (Apple, Google, Mozilla). No server of your own and no inbound port is needed, also not in iroh mode.

- **Enable** in Inbox → bell icon (or ⌘K → Notifications). Browsers only ask for permission after a click.
- **iPhone / iPad:** push works only in the app added to the Home Screen (iOS / iPadOS 16.4 or later): Safari → Share → *Add to Home Screen*, open it from there, then enable. The settings dialog explains this when it runs in plain Safari.
- **Per device:** which kinds push (approvals and questions, done, errors and limits, Paseo agents at all), optional quiet hours (in the device's time zone) and "don't push while the app is open and visible" (the UI reports its visibility; then only the in-app toast appears).
- **Payload:** only the chat title and the kind ("Approval needed", "Done", "Error"). A click opens the thread or the inbox. On browsers with reliable notification actions (not Apple's push service) Hermes approvals get *Allow …* / *Deny …*; these open the app with a confirmation dialog and never answer by themselves.
- **Lifecycle:** subscriptions belong to a paired device and are deleted when it is unpaired or signs out; subscriptions the push service reports as gone (404/410) are removed.
- **Service worker:** `web/public/sw.js` is the one worker for the UI's scope. It imports iroh-fetch's `iroh-sw.js` (media over iroh) and adds the `push` and `notificationclick` handlers.

## How it talks to Hermes

- **Read:** `$HERMES_HOME/state.db`, opened read-only (`node:sqlite`) and polled every 1.5 s, plus the Hermes gateway's event stream.
- **Write:** like the Hermes desktop app does it. The backend gets a single-use ticket from `gateway.sock`, then uses the gateway WebSocket with JSON-RPC `session.create`, `prompt.submit`, `session.resume`, `session.interrupt`, `approval.respond` and `clarify.respond`. Images go through `/api/chat/image-upload`, voice through `/api/audio/transcribe`.
- **Never:** it writes nothing under `$HERMES_HOME`, never restarts the Hermes gateway, and sends no commands to the Paseo daemon. The one write to Paseo is your own answer to a permission request from the inbox, through paseo-mcp.

