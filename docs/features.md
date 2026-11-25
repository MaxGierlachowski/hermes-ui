# Features

What the board, the thread panel and the inbox do, in detail. The mobile app: [app.md](app.md).


- **Board:** drag & drop (dnd-kit). On a phone it switches to tabs per column.
- **Column rules:**
  - Doing: Hermes is running a turn, or an agent the session started is still running: a Paseo agent ("Paseo running (n)") or one of Hermes' own subagents / terminal runs ("Agents running (n)").
  - Waiting: the turn has finished and nothing of the session runs any more, or there is an open approval or clarify prompt.
  - Done: **only you** set it, and it sticks until you write in that session again.
  - Finished cron, webhook and one-shot runs go to Done; they are visible behind the "Cron/system" filter.
  - The board shows the newest chats first (50 per page plus pinned cards); scrolling to the end of a column loads older ones. Cron and system runs are filtered out before the page is cut, so they never crowd out real chats. An optional time window (1/3/7/30 days) narrows it further.
- **Thread panel:**
  - Full transcript with tool calls (collapsible) and images, live streaming, stop button.
  - Composer with text, images (paste or drag & drop) and voice messages. Voice is recorded with MediaRecorder and transcribed by Hermes' own STT.
  - **Summary pill:** a small floating "Summary" pill sits right above the composer. A click sends one fixed prompt as an ordinary message into that chat (the composer's own send path, no special route): Hermes summarizes the chat, explains what was decided or done and why, and lists every open task with what, who and what blocks it, answering in the chat's language and without starting new work. The pill is hidden while the chat is empty, while Hermes works on a turn or waits for an approval / answer, and for drafts; after a click it shows "Requesting summary …" and then "Summary requested", and a second click in that time sends nothing. The prompt text lives in one place, `shared/summary.ts` (app and web UI).
  - While a voice message is transcribed and sent, the composer shows "Transcribing voice message …" with an indeterminate bar, the recording's length and the seconds waited (Hermes' STT reports no progress). A recording that could not be sent stays in the composer with *send again* / *discard*; a failed transcription is reported (the message then goes out as an audio file). Nothing about a voice message fails silently.
- **Approvals and questions:** shown on the card and inline in the thread.
  - Approval: approve with the options Hermes offers (once / session / always) or deny.
  - Clarify: answer with buttons, multi-select or free text, or skip. A countdown shows when Hermes gives a time limit.
- **Hermes' own agents (read-only):** subagents a chat starts with `delegate_task` and Hermes runs started through the terminal tool (`hermes [-p <profile>] chat -q …`) appear exactly like Paseo agents: inline after the message that started them, in the chat's agent list with state and full transcript, as chips on the card, and they keep the chat in Doing while they run.
  - Subagents are tied to the chat by Hermes' own ids (`parent_session_id`, subagent id). Terminal runs carry no parent id in Hermes; they are matched by prompt or start time and labelled "matched by prompt / start time (heuristic)".
  - State comes from Hermes' data: the child session ended, the delegation record, the exit code in Hermes' "process complete" notice, and whether the run's process is still alive. Details: [decisions/0013](decisions/0013-hermes-child-agents.md).
- **Paseo agents (optional; read-only except answering permissions from the inbox):**
  - The board finds a session's agents from the session's own `paseo_*` tool calls and shows them as chips with their live state. Agent labels, successors and a manual attach add more: see [Linking agents to chats](#linking-agents-to-chats).
  - The live state comes from [paseo-mcp](https://github.com/MaxGierlachowski/paseo-mcp) events (≥ 0.4.0): a subscription to the `paseo://agents` resource, with no polling. A direct daemon connection is the fallback. When the daemon is reachable it also provides richer transcripts and the app deep link.
  - The "Paseo agents" tab lists them; a transcript view shows each one read-only, updating live while the agent runs.
  - A deep link (`paseo://h/<server>/agent/<id>`) opens the agent in the Paseo app.
  - Images that agents reference by local path (`file:///…`, `/Users/…`) are served read-only by `/api/file`: image types only, only below the allowed roots (see `HERMES_UI_IMAGE_ROOTS`), checked on the real path. Missing files show a placeholder; a click opens a lightbox.
  - Files Hermes attaches to a reply with `MEDIA:<path>` (what Slack shows as attachments) appear under the message: images, audio players, other files by name. Only exactly those referenced files become readable, the tags never show up in the text, not even while streaming.
- **Tabs:** Board and Inbox, in the header on a desktop and as a bottom tab bar on a phone. The tab is part of the URL (`#/board`, `#/inbox`, `#/inbox/<session>`, `#/inbox/item/<entry>`), so a reload or a link keeps it. `g b` / `g i` switch.
- **Inbox (across all chats):**
  - *Needs you:* every open Hermes approval and clarify question of every followed session, answerable in place with the same controls and countdown as in the thread, and every Paseo agent with a pending permission (agent, tool, command or description), answerable with Allow / Deny via paseo-mcp's `paseo_respond_permission`. Each entry names its chat and links to the thread.
  - *History:* requests and how they were answered (here, elsewhere, expired), finished chats, errors, Paseo agents that finished, failed or hit a usage limit, and automations (below). Read/unread, "mark all read", filters by kind and by source (Chats / Agents / Automations), grouped by day. Stored in `<data-dir>/inbox.json` (30 days / 1000 entries by default).
  - *Automations:* cron runs, webhook runs and script messages that reported something, one group per job, route or notify group (unread count, newest first, ok / error). An entry shows title, one-line text, time and status; expanded, the full report as Markdown. With a chat (agent cron runs, webhook runs, notify with `sessionId`) *Open chat* opens it, and you can write on there; script runs without a chat only expand. See [Automations in the inbox](#automations-in-the-inbox).
  - A Hermes chat counts as *done* only when Hermes' turn is over **and** none of the Paseo agents it started or steers is still running or waiting for a permission (the same rule as the columns). A Paseo agent finishing is its own entry.
- **In-app notifications:** toasts for new requests and finished chats while the app is visible (a click opens the thread or the inbox), a badge on the Inbox tab and on the app icon (Badging API where available).
- **Push notifications (Web Push, see below).**
- **Search (⌘K, `/` or the search field):** full text over the titles and content of all chats, using Hermes' own FTS5 index (`messages_fts`, read-only; user and Hermes messages, no tool output). Results show title, source, column, last activity, message and Paseo-agent counts and a snippet with the hit marked; Enter opens the thread at the matching message. Archived chats on request. Also: new chat (N), theme, language, cron/system filter, remote access.
- **Light and dark mode**, English and German, a mobile layout, and installable as a PWA.
- **Phones and tablets:** every control is at least 44 × 44 px to hit (Apple HIG; checked by a test), fields use 16 px text so iOS does not zoom in, and nothing changes for a mouse.
  - The thread opens as a bottom sheet: drag it down to close. The composer is one row (attach · text · one round button that is the mic, send, or stop), Enter makes a new line, and it stays above the keyboard on iOS too.
  - Board: column tabs, swipe sideways to switch columns, long-press a card to move it. Column choice, new chat, notifications and remote access open as bottom sheets; search is full screen.
  - Images (thread, attachments, Paseo transcripts) open full screen: pinch or double-tap to zoom the image only (the app itself never zooms), drag to pan, swipe down to close.
- **Image viewer in the app (phone, web, desktop):** the image is shown at its own size (at most the window) on a dark backdrop, with a spinner while it loads; pinch or double-tap zooms, the X, Esc / back or a click beside the image closes it. An image that does not load shows "The image could not be loaded" with its file path (never the access token) and, for plain web URLs, a link to open it.

## Linking agents to chats

A card counts every Paseo agent that belongs to its chat's work: while one runs, the card stays in Doing; while one waits for a permission, the card waits. An agent belongs to a chat in four ways, all at once:

1. **Transcript (automatic):** the chat itself created, steered or watched the agent: `paseo_*` tool calls through paseo-mcp, or the `paseo` CLI and scripts in the terminal tool.
2. **Labels (set by whoever starts the agent):** an agent label whose value is a Hermes session id links the agent to that chat as *started* (it keeps the card in Doing). Any of these keys works:

   | Label | Value |
   |---|---|
   | `hermes_session_id` | the Hermes session id (e.g. `20261123_101500_1a2b3c4d`) |
   | `hermes_chat_id` | the same, for orchestrators that call it a chat |
   | `origin_ref` | the same, for orchestrators that already set an origin reference |

   Only values that are a session in Hermes' `state.db` count; anything else (a Slack thread id, a ticket number) is ignored. Set the label when creating the agent, for example `paseo run --label hermes_session_id=<id> …`, or `labels: { hermes_session_id: '<id>' }` in a daemon client's `agents.create`. Skills, crons and webhooks that start work for an existing chat should always set it.
3. **Successors:** an agent with the label `predecessor=<agent id>` (the full id or a unique prefix of at least 6 hex characters, like `paseo ls` prints) inherits every chat link of that predecessor, with the predecessor's relation (*started* / *steered* / *watched*). Chains of restarts work (the predecessor's own `predecessor` is followed, cycles end the chain), and an archived predecessor still passes its links on. Use it when an agent is restarted on another account after a usage limit, or continued by another Hermes run. The agent list shows "successor of …" under the new agent; the archived one sits in the archived group.
4. **By hand:** the agent list of a card has *Attach agent…* (running and idle agents of the daemon) and, on every Paseo agent, *Detach* (the unlink icon). Both are stored in `<data-dir>/board.json` (`attached`, `detached`) like manual column moves. A detached agent stays off that card whatever its labels or the transcript say, until it is attached again. Nothing is sent to Paseo or the agent.

**Continued chats:** links to a child session (`parent_session_id`: a delegate_task subagent, or a chat Hermes continues in a new session row) count for the root session, the one the board shows as a card. A label may name either.

**Waiting on background work:** an agent that ended its turn while its own background tasks still run (a `run_in_background` shell, a pipeline watcher) is reported as idle / finished by Paseo, and the card follows that. Paseo's protocol has no field for running background tasks yet; the board does not guess from the agent's text.

## Push notifications

Standard Web Push with VAPID. The backend generates its key pair on first start (`<data-dir>/vapid.json`, never part of the repo) and sends outgoing HTTPS requests to whatever push service the browser uses (Apple, Google, Mozilla). No server of your own and no inbound port is needed, also not in iroh mode.

- **Enable** in Inbox → bell icon (or ⌘K → Notifications). Browsers only ask for permission after a click.
- **iPhone / iPad:** push works only in the app added to the Home Screen (iOS / iPadOS 16.4 or later): Safari → Share → *Add to Home Screen*, open it from there, then enable. The settings dialog explains this when it runs in plain Safari.
- **Per device:** which kinds push (approvals and questions, done, errors and limits, Paseo agents at all, automation reports, automation errors, script messages), optional quiet hours (in the device's time zone) and "don't push while the app is open and visible" (the UI reports its visibility; then only the in-app toast appears).
- **Payload:** only the chat title and the kind ("Approval needed", "Done", "Error"); automations: the job / group name and the entry's one-line title. A click opens the thread or the inbox. On browsers with reliable notification actions (not Apple's push service) Hermes approvals get *Allow …* / *Deny …*; these open the app with a confirmation dialog and never answer by themselves.
- **Lifecycle:** subscriptions belong to a paired device and are deleted when it is unpaired or signs out; subscriptions the push service reports as gone (404/410) are removed.
- **Service worker:** `web/public/sw.js` is the one worker for the UI's scope. It imports iroh-fetch's `iroh-sw.js` (media over iroh) and adds the `push` and `notificationclick` handlers.

## Automations in the inbox

Hermes' cron jobs, webhook runs and your own scripts report into the inbox instead of a chat channel.
Decision and details: [ADR 0014](decisions/0014-automations-in-the-inbox.md).

- **Cron:** every run of every job, whatever its `deliver` target (also `deliver: local`), from the run
  archives Hermes writes to `$HERMES_HOME/cron/output/<job>/<time>.md` (read-only). Only runs that
  reported something: silent (`[SILENT]`), suppressed (`no_change`, wake gate off) and empty runs stay out.
  Failures (`script failed`, `BLOCKED (configuration)`, an exception, the `[CRON_FAILURE]` marker,
  a one-shot dropped before it fired) are entries with status *error*; the same error again only
  counts up (×N) on the newest entry of its group. Agent runs link to their chat; no-agent scripts have none.
- **Webhook:** every webhook run whose final reply is not `[SILENT]`, grouped by route (`webhook/<route>`),
  linked to its chat.
- **Scripts and other Hermes profiles:** `POST /api/notify` or the CLI:

  ```sh
  df -h /data | hermes-ui notify --title "Disk almost full" --group disk-alert --level warn
  hermes-ui notify --title "Deploy done" --group deploy --text "**v1.4.2** is live" --url https://example.com/releases/1.4.2
  curl -sS -X POST http://127.0.0.1:8787/api/notify -H "Authorization: Bearer $HERMES_UI_NOTIFY_TOKEN" \
    -H 'Content-Type: application/json' -d '{"title":"Backup failed","group":"backup-check","level":"error","text":"exit 2"}'
  ```

  Fields: `title` (required, ≤ 200), `text` (Markdown, ≤ 8000), `group` (default `notify`), `level`
  (`info` | `warn` | `error`; error counts as a failure), `sessionId` (a chat to open), `url` (http/https
  link). Bodies over 64 KB are refused (413), no token 401. Auth: the board token or
  `HERMES_UI_NOTIFY_TOKEN`, which may call nothing else.
- **Chat jump:** cron and webhook sessions can be continued; Hermes' gateway reopens them with the first
  new prompt. They still never appear as board cards.
- **Start:** the first start begins at "now" (`HERMES_UI_AUTOMATIONS_BACKFILL_HOURS` reaches back);
  restarts continue where the last scan stopped, without duplicates. Noisy jobs or routes:
  `HERMES_UI_AUTOMATIONS_IGNORE`. All options: [configuration.md](configuration.md).
- **Push:** *Automations: reports*, *Automations: errors* and *Script messages* per device (all on by
  default). Title = job / route / group, text = the entry's one-line title; a tap opens the chat, or the
  entry in the inbox.

## How it talks to Hermes

- **Read:** `$HERMES_HOME/state.db`, opened read-only (`node:sqlite`) and polled every 1.5 s, plus the Hermes gateway's event stream.
  Also read-only, every 15 s: `$HERMES_HOME/cron/output/` (run archives) and `cron/jobs.json` (job names) for [automations](#automations-in-the-inbox).
- **Write:** like the Hermes desktop app does it. The backend gets a single-use ticket from `gateway.sock`, then uses the gateway WebSocket with JSON-RPC `session.create`, `prompt.submit`, `session.resume`, `session.interrupt`, `approval.respond` and `clarify.respond`. Images go through `/api/chat/image-upload`, voice through `/api/audio/transcribe`.
- **Never:** it writes nothing under `$HERMES_HOME`, never restarts the Hermes gateway, and sends no commands to the Paseo daemon. The one write to Paseo is your own answer to a permission request from the inbox, through paseo-mcp.

