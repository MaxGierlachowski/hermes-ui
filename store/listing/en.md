# Store listing – English (en-US)

Each field below is the exact text to paste: copy what is inside the fenced block, nothing else.
`<!-- field: … max=… -->` marks a length-limited field; [`../README.md`](../README.md#checking-the-lengths)
has the snippet that counts them.

## Names (the only place the store-visible name is set)

The working name is **Hermes UI**. It appears **only** in the two title fields below; every other
text says "the app" (and "Hermes" always means Hermes Agent), so a rename means editing this section
only.

<!-- field: apple.name max=30 -->
```text
Hermes UI for Hermes Agent
```

<!-- field: play.title max=30 -->
```text
Hermes UI for Hermes Agent
```

Pattern for other names: `<Name> for Hermes Agent` (the suffix is 17 characters, so the name itself can
have at most 13).

## Subtitle (App Store)

<!-- field: apple.subtitle max=30 -->
```text
Self-hosted AI agent on the go
```

## Short description (Google Play)

<!-- field: play.short max=80 -->
```text
Unofficial, self-hosted client for Hermes Agent: board, chats, approvals.
```

## Promotional text (App Store)

Can be changed at any time without a new review.

<!-- field: apple.promo max=170 -->
```text
New: try the whole app without a backend. Tap "Try the demo" on the first screen to explore the board, threads and inbox with sample data.
```

## Description (App Store description and Google Play full description)

Plain text; both stores show line breaks but no Markdown.

<!-- field: description max=4000 -->
```text
A mobile client for Hermes Agent that you host yourself. Every Hermes chat shows up as a card on a live Kanban board, and you can follow, answer and steer your agent from your phone.

Unofficial app: this is an independent open-source project. It is not affiliated with, endorsed by or sponsored by Nous Research, the makers of Hermes Agent.

HOW IT WORKS
You run the open-source backend on your own computer, next to Hermes Agent. The app pairs with it once through a QR code and then connects end-to-end encrypted over iroh (peer-to-peer QUIC): directly when it can, otherwise through a relay that only forwards encrypted traffic. No account, no cloud service of the developer, no open port on your machine.

THE BOARD
• Every chat – from the desktop, Slack, cron jobs, the CLI or the app – is a card
• Columns New Task, Doing, Waiting and Done, updated live
• Swipe between columns, pull to refresh, see at a glance which chat needs you

THREADS
• Replies stream in as Hermes writes them
• Markdown, code blocks, tool calls, images and voice messages
• Start new chats and answer with text, photos from your library or camera, or a voice message
• Stop a running turn

APPROVALS AND QUESTIONS
• Approve or deny commands Hermes wants to run (once, for the session, always)
• Answer clarifying questions with the offered options or free text
• One inbox collects every open request across all chats, plus a history

CODING AGENTS
• See the Paseo coding agents a chat started, with read-only transcripts
• Answer their permission requests from the inbox

MADE FOR THE PHONE
• Full-text search across all chats
• Offline cache: the last state shows instantly, also without a connection
• Light and dark mode, English and German
• Android: share text or images from other apps to start a chat
• Notifications for finished replies and new requests while the app runs; on Android optionally in the background through a quiet ongoing notification

TRY IT WITHOUT A BACKEND
Tap "Try the demo" on the first screen. The demo shows sample chats, an approval, a question, coding agents and the inbox, and plays a streamed reply when you send a message. Nothing leaves your device.

PRIVACY
The app has no analytics, no ads and no tracking, and the developer receives none of your data. Chats, images and voice messages travel only between your phone and your own backend, end-to-end encrypted.

WHAT YOU NEED
• Hermes Agent running on your computer
• The free, open-source backend (MIT licence) from the project's GitHub page
• A few minutes for the setup; the guide on GitHub walks you through it

Open source under the MIT licence. Issues and contributions are welcome on GitHub.
```

## Keywords (App Store)

Comma-separated, no spaces after the commas, no words that are already in the name, no third-party
trademarks.

<!-- field: apple.keywords max=100 -->
```text
ai,assistant,kanban,self-hosted,llm,chatbot,approvals,inbox,encrypted,p2p,remote,voice,open source
```

## What's new in version 0.3.0

First store version. Google Play shows it as release notes (500 characters per language). App Store Connect offers the field only from the second version on; reuse the text there for 0.3.1+ (limit 4000).

<!-- field: whatsnew max=500 -->
```text
First release in the stores.
• Demo mode: tap "Try the demo" on the first screen to explore the app with sample data, no backend needed
• Ready for the stores: privacy manifest, only the permissions the app needs, clearer notification and background settings
• Exit the demo at any time and pair with your own backend
```

## URLs

| Field | URL |
|---|---|
| Support URL (Apple, required) / Play "Website" | https://maxgierlachowski.github.io/hermes-ui/support/ |
| Privacy policy URL (both stores, required) | https://maxgierlachowski.github.io/hermes-ui/privacy/ |
| Marketing URL (Apple, optional) | https://github.com/MaxGierlachowski/hermes-ui |
| Contact e-mail (Play, required; Apple review contact) | {{CONTACT_EMAIL}} |

## Category suggestion

- App Store: primary **Productivity**, secondary **Developer Tools**.
- Google Play: **Productivity**. Tags: Productivity, Tools.
