# Review notes

Texts for the reviewers of both stores. The fenced blocks are meant to be pasted as they are.

- **App Store Connect:** App → version → *App Review Information* → *Notes* (limit 4000 characters).
  *Sign-in required*: **off** (there is no sign-in). Contact: {{PROVIDER_NAME}}, {{CONTACT_EMAIL}}.
- **Play Console:** *Policy → App content → App access* → "All or some functionality in my app is
  restricted" → *Add instructions* (see below).

The app's name appears in these texts as "Hermes UI"; replace it there if the name changes.

## App Store: App Review notes

<!-- field: apple.review-notes max=4000 -->
```text
WHAT THE APP IS
Hermes UI is an unofficial, open-source (MIT) mobile client for Hermes Agent, an AI agent that people run on their own computer. It is not affiliated with Nous Research, the makers of Hermes Agent. The app has no accounts and the developer runs no server: each user runs the open-source hermes-ui backend on their own computer next to Hermes Agent. The app pairs with that backend once by scanning a QR code and then connects end-to-end encrypted over iroh (peer-to-peer QUIC, directly or through a relay that only forwards encrypted traffic).

HOW TO REVIEW: USE THE BUILT-IN DEMO (no login, no backend)
1. Open the app. The first screen is the pairing screen ("Not connected", with "Scan QR code" and a field for a pairing link).
2. Tap "Try the demo" at the bottom of that screen.
3. The app now runs exactly as with a real backend, but on sample data generated on the device. Nothing is sent anywhere.

What the demo shows:
- Board: eight sample chats in the columns New Task, Doing, Waiting and Done (swipe sideways between columns; chats in Doing show live activity).
- Thread: open "Fix the landing page build and deploy it": Markdown, a code block, tool calls, an image (tap to zoom), a webhook event card, coding-agent cards, and an approval request you can approve or deny.
- Clarifying question: "Prepare release 1.4" asks a question with three options.
- Inbox tab: all open requests across chats (approval, question, a coding-agent permission) and a history of finished items.
- Sending: type a message in any chat (or start one with the "New chat" button) and send it. The chat moves to Doing, a reply streams in word by word, then the chat moves to Waiting and a "Reply ready" entry appears in the Inbox.
- Coding agents: chips on the first card open read-only agent transcripts.
- Search (magnifier icon) and Settings (gear icon): theme, board options, notifications.
- The "Demo · exit" badge in the header (or Settings → "Exit the demo and pair") returns to the pairing screen.
The demo follows the device language (English or German).

A REAL SETUP (for reference)
Install the hermes-ui backend on the computer that runs Hermes Agent, start it with remote access over iroh and run "hermes-ui pair". The app scans the QR code; from then on the backend admits only this paired device. Guide: https://github.com/MaxGierlachowski/hermes-ui/blob/main/docs/self-hosting.md

PERMISSIONS, ALL ASKED ONLY WHEN THE FEATURE IS USED
- Camera: scan the pairing QR code; take a photo to attach to a chat.
- Microphone: record a voice message for the agent.
- Photo library: attach an image from the library to a chat.
- Notifications: tell the user when the agent has finished a reply or needs an approval.
- Local network: connect directly to the user's own backend when it is on the same Wi-Fi (asked when pairing with a real backend; not used in the demo).
The app collects no data: no analytics, no ads, no tracking, no third-party SDKs that collect data. Chats, images and voice messages travel only between the phone and the user's own backend.

ENCRYPTION
The app contains standard encryption (TLS 1.3 / QUIC via rustls inside the open-source iroh library) to protect the connection to the user's own backend. ITSAppUsesNonExemptEncryption is set accordingly.

DEMO MODE INSTEAD OF A DEMO ACCOUNT (Guideline 2.1)
Because every user connects to a backend on their own computer, there is no shared server and no account we could give you, and we cannot expose a personal machine for review. Instead the app has a fully featured, built-in demo mode that is available to everyone from the first screen and shows every screen and interaction of the app. We kindly ask you to approve the demo mode in lieu of a demo account.
```

## App Store: request for approval of the demo mode

Guideline 2.1 allows "a built-in demo mode in lieu of a demo account **with prior approval by
Apple**". The last paragraph of the notes above asks for it in the review itself. To ask beforehand,
send this through *App Store Connect → Contact Us → App Review* (or the [App Review contact
form](https://developer.apple.com/contact/app-store/?topic=appeal)), choosing a general question
about the review:

```text
Subject: Approval of a built-in demo mode instead of a demo account (Guideline 2.1)

Hello App Review team,

our app Hermes UI (bundle ID {{IOS_BUNDLE_ID}}) is an open-source client for a self-hosted AI agent. Every user runs the backend on their own computer and pairs the app with it by QR code; there are no user accounts and no central server, so we cannot provide a demo account or a reachable test backend without exposing a private computer.

The app therefore includes a built-in demo mode, reachable from the first screen via "Try the demo", without login or network access. It shows every screen and feature of the app (board, threads with streamed replies, approvals, questions, inbox, search, settings) on sample data generated on the device.

We would like to ask for approval to use this demo mode in lieu of a demo account, as described in Guideline 2.1. The review notes of each submission explain the steps.

Thank you,
{{PROVIDER_NAME}}
{{CONTACT_EMAIL}}
```

## Google Play: App access

Play Console → *App content → App access* → **All or some functionality in my app is restricted** →
*Add instructions*:

| Field | Value |
|---|---|
| Name of the instruction | `Demo mode (no login needed)` |
| Username / Password | leave empty (there is no login) |
| "Any other information required to access your app" | the block below |
| "Allow Android to use the credentials … for performance and app compatibility testing" | not applicable (no credentials) |

<!-- field: play.app-access max=500 -->
```text
No account exists. Users pair the app by QR code with a backend on their own computer. To review without a backend, tap "Try the demo" on the first screen: board, chats with streamed replies, approvals, questions, inbox and settings run on sample data on the device. "Demo · exit" in the header returns to pairing. Self-hosting guide: https://github.com/MaxGierlachowski/hermes-ui/blob/main/docs/self-hosting.md
```

The Play field's limit is not documented in one place; the text is kept under 500 characters to be safe.

## Google Play: notes on the foreground service

Reviewers who look at the foreground service find it under Settings → "Stay connected in the
background" (Android only). Details, the declaration texts and the video shot list are in
[`play/foreground-service.md`](play/foreground-service.md). In the demo the setting works the same way:
choose "While Hermes works", send a message, go to the home screen – the ongoing notification appears
while the simulated reply plays, and the finished reply arrives as a notification.
