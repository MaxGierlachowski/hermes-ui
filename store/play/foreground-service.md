# Google Play – foreground service declaration (draft)

Play Console → *Policy → App content → Foreground service permissions*. Apps targeting Android 14+
(this one targets SDK 36) must declare every foreground service type they use, describe the feature,
the user impact if the task is deferred or interrupted, and link a video.

## What the app declares

| Item | Value |
|---|---|
| Permission | `android.permission.FOREGROUND_SERVICE_DATA_SYNC` (plus `FOREGROUND_SERVICE`, `POST_NOTIFICATIONS`) |
| Service | `expo.modules.iroh.KeepAliveService`, `android:foregroundServiceType="dataSync"` (`mobile-app/modules/expo-iroh/android/src/main/AndroidManifest.xml`; `HERMES_UI_FGS_TYPE` overrides it at build time, see below) |
| Time limit | Android 15+ allows `dataSync` 6 h per 24 h: at the limit the system calls `onTimeout()`, the service stops itself, and the app starts it again the next time it is in the foreground |
| Started | only from the foreground (the app checks `AppState === 'active'` before it starts the service), never at boot, never from a background broadcast |
| Stopped | 30 seconds after the agent's last turn finished (mode "While Hermes works"), immediately when the user switches the setting to "Off", and when the connection ends (e.g. "Forget connection" or exiting the demo) |
| Notification | low-importance, ongoing: "Hermes is working on 1 chat(s) – replies arrive as notifications" / "Connected – new inbox entries arrive as notifications" |

Not used and blocked in `app.config.ts`: `FOREGROUND_SERVICE_MEDIA_PLAYBACK`. No other foreground
service types.

## Declaration texts

Paste per field. Play does not publish hard limits for these fields; the texts are kept short.

**Foreground service type:** Data sync

**Use case (preset list):** network transfer / sync of user data

**Describe the feature that uses this foreground service type**

<!-- field: play.fgs.feature max=1000 -->
```text
The app is a client for the user's own, self-hosted AI agent (Hermes Agent). Data travels end-to-end encrypted over the network between the phone and the user's own computer (peer-to-peer); there is no server of the developer and no push provider. After the user sends a request to the agent from the phone, the service keeps the network transfer running until the agent's reply and any approval request it needs have been received on the phone and shown as notifications. The user turns the feature on in Settings ("Stay connected in the background": While Hermes works / Always / Off). A quiet ongoing notification shows the state the whole time. In the default mode the service stops by itself 30 seconds after the agent has finished.
```

**Describe the user impact if the task is deferred by the system or interrupted**

<!-- field: play.fgs.impact max=1000 -->
```text
Android freezes a backgrounded app within seconds, which closes the connection to the user's computer. Without the service, the agent's reply and its approval requests would not reach the phone until the user opens the app again. Approval requests block the agent: if the user does not see them, the agent stops and waits, and some requests expire after a timeout, so the task fails. Because the connection is peer-to-peer to the user's own computer and the developer runs no server, there is no way to deliver these messages with Firebase Cloud Messaging or a deferrable job instead.
```

**How does the user start it?** (if the form asks)

```text
Settings → "Stay connected in the background" → "While Hermes works" (default) or "Always". With "While Hermes works" the service runs only while the agent is working on a chat and the user has sent a message from the app; it ends 30 seconds after the reply. "Off" disables it.
```

**Video link:** URL of the demo video (unlisted YouTube video or a publicly readable Google Drive file).
Shot list below.

## Demo video: shot list (≤ 2 minutes, demo mode, no backend)

Record on a real Android 14+ phone or an emulator with screen recording (`adb shell screenrecord`, or
the emulator's record button). Portrait, no audio needed. Show the notification shade clearly; slow,
deliberate taps. Language: English.

Preparation: fresh install (or "Clear storage"), notifications allowed when asked.

| # | Time | Action | What must be visible |
|---|---|---|---|
| 1 | 0:00–0:08 | Open the app from the launcher. | Pairing screen: "Not connected", "Scan QR code", "Try the demo". |
| 2 | 0:08–0:15 | Tap **Try the demo**. | Board with sample chats; "Demo · exit" badge in the header. |
| 3 | 0:15–0:22 | If Android asks for notification permission: tap **Allow**. (Otherwise allow it in Settings in step 4 via "Notifications".) | System permission dialog. |
| 4 | 0:22–0:40 | Tap the gear icon → **Settings**. Scroll to "Stay connected in the background". Tap **While Hermes works** (already selected by default: tap it anyway so the choice is on camera). Hold 3 s on the explanation text. | The three options While Hermes works / Always / Off and the text "Android freezes background apps within seconds …". |
| 5 | 0:40–0:50 | Go back to the board. Open the chat **"Summarise the week for the team"** (column Waiting). | Thread with messages. |
| 6 | 0:50–1:00 | Type "Please add the open tasks." and tap **Send**. | Message appears; the chat starts working ("Thinking …"). |
| 7 | 1:00–1:05 | **Immediately** press Home (the simulated reply takes about 3 seconds). | Launcher; the ongoing notification icon appears in the status bar. |
| 8 | 1:05–1:20 | Pull down the notification shade. | Ongoing notification "Hermes UI" – "Hermes is working on 1 chat(s) – replies arrive as notifications". |
| 9 | 1:20–1:35 | Wait in the shade. | A new notification "Done · Summarise the week for the team" with the text "Reply ready" appears while the app is in the background. |
| 10 | 1:35–1:50 | Wait about 30 seconds (cut the wait with a visible jump cut or keep it), then show the shade again. | The ongoing notification is gone: the service stopped by itself. |
| 11 | 1:50–2:00 | Tap the "Reply ready" notification. | The app opens on the thread with the finished reply. |

Tips:

- If the reply arrives before you reach the home screen, send another message and leave faster, or open
  a different chat first – each send plays a new reply.
- Optional second take for "Always": select **Always**, go home, show the ongoing notification
  "Connected – new inbox entries arrive as notifications", then switch back to **Off** and show it
  disappear. Keep the total video under 2 minutes.
- Do not show a real backend, real chats, IP addresses or endpoint ids in the video.

## Other types (build-time switch)

`dataSync` is the default because Play documents it for "transfer data between a device and the
network" and it needs no special justification. Its Android 15+ limit (6 h per 24 h) matters only for
"Always"; "While Hermes works" stops 30 seconds after each turn. Alternatives, selected with
`HERMES_UI_FGS_TYPE` in `mobile-app/.env` (config plugin `plugins/with-keepalive-type.js`; the service
reads its type from the manifest, so no code changes):

1. **`remoteMessaging`** (`FOREGROUND_SERVICE_REMOTE_MESSAGING`): no time limit. Google describes it as
   "transfer of text messages from one device to another … continuity of a user's messaging tasks when
   they switch devices". Messages between the phone and the user's own computer can be read that way,
   but a reviewer may not. Replace "Data sync" above by "Remote messaging" and adapt the feature text.
2. **`specialUse`** (`FOREGROUND_SERVICE_SPECIAL_USE`): for valid cases no other type covers. The plugin
   adds the required `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` text; Google reviews it and the Play Console
   justification more strictly.
3. **No foreground service (FCM only):** set "Off" as default and remove the setting from a store build;
   the app then notifies only while it is open, unless the user builds it with their own Firebase project
   (`GOOGLE_SERVICES_JSON` + `HERMES_UI_FCM_SERVICE_ACCOUNT`, see `docs/mobile-app.md`). Simplest for
   review, weakest for users.

If Google rejects the declaration: appeal with more context first (self-hosted peer-to-peer, no
developer server, user-started, visible, stops by itself), with the video attached again.
