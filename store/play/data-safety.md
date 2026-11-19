# Google Play – Data safety form (draft)

Play Console → *Policy → App content → Data safety*. Draft answers, question by question, for the
**store build as it is meant to ship: without Firebase** (no `GOOGLE_SERVICES_JSON` at build time).
The section [Push via Firebase (FCM)](#push-via-firebase-fcm-how-to-answer) explains what changes if
a store build ever includes it.

Google's definitions this draft relies on (Play Console Help, "Provide information for Google Play's
Data safety section"):

- **Collected** = transmitted off the device *by the app* (to the developer or a third party).
- **Shared** = transferred to a third party.
- Not to be declared: data processed only on the device; data sent with **end-to-end encryption**
  that makes it unreadable to anyone except sender and recipient; transfers the **user initiates and
  reasonably expects** (sharing exception).

Re-read the current Help page before submitting: Google adjusts these definitions from time to time.

## Facts about the app (basis for every answer)

| What | Where it goes | Who can read it |
|---|---|---|
| Chats, images, voice messages, approvals, search queries | only between the phone and the backend **the user runs on their own computer**, over iroh (QUIC, TLS 1.3, end-to-end encrypted) | the user (phone and own computer). The developer never receives anything: there is no developer server. |
| Pairing information (backend endpoint id, relay URL) and the device's own iroh key | stored on the device in the Android Keystore (`expo-secure-store`) | stays on the device |
| Cache of the board, recent messages, images and audio (≤ 200 MB) | app-private storage on the device | stays on the device; deleted by "Forget connection" or uninstall |
| Settings (theme, board column, notification and keep-alive mode) | app-private storage | stays on the device |
| Connection metadata: the device's iroh endpoint id (a public key), IP address, traffic timing/volume | the iroh relay chosen **by the user's backend** (n0's public relays by default, or the user's own relay) and, for discovery, n0's DNS discovery service | the relay operator sees this metadata, never content (content is end-to-end encrypted) |
| Demo mode | nothing leaves the device | – |
| Analytics, crash reporting, advertising, attribution | **none in the app** | – |

## Section 1: Data collection and security

**Does your app collect or share any of the required user data types?**
→ **No.**

Reasoning to keep on file:

1. User content (messages, photos, audio, files) is sent only to the user's **own** backend, over an
   end-to-end encrypted connection, at the user's explicit action (pairing, sending). Neither the
   developer nor any third party can read it. This is the end-to-end-encryption exception, and the
   backend is the user's own system, not the developer's.
2. Nothing is stored or processed by the developer: there is no developer server, account system or
   SDK that reports to the developer.
3. Relay metadata. The relay needs the endpoint id and IP address to forward encrypted packets, like
   any transport layer. The endpoint id is a random public key generated on the device, not tied to
   the user's identity, the hardware or an advertising ID; the relay is chosen by the user's backend
   configuration (default: n0's public relays; or the user's own relay). We treat this as network
   transport, not as data "collected" by the app. See the conservative alternative below if you prefer
   to declare it.

If you answer **No**, the form skips the remaining questions of this section and the store listing shows
"No data collected" and "No data shared with third parties".

### Conservative alternative (only if you decide to declare relay metadata)

If you'd rather declare the endpoint id that relays and the discovery service see:

| Question | Answer |
|---|---|
| Data types | **Device or other IDs** (the iroh endpoint id) |
| Collected / shared | Collected: yes. Shared: no (transfer to a service provider that only transports data is not "sharing") |
| Processed ephemerally? | No (the public key is stable per installation) |
| Required or optional? | Required (needed to connect at all) |
| Purpose | **App functionality** |
| Is all user data encrypted in transit? | Yes |
| Can users request deletion? | Yes: "Forget connection" removes the pairing; uninstalling deletes the key |

The cost of this alternative is a less accurate "collects device IDs" label for an app whose point is
that it collects nothing. Recommendation: answer **No**, keep this file as the record of why.

### Questions shown only when the answer above is "Yes"

Drafts, in case Google's definitions or the build change:

| Question | Draft answer |
|---|---|
| Is all of the user data collected by your app encrypted in transit? | **Yes.** All traffic to the backend is QUIC with TLS 1.3 (rustls, inside iroh); relays only forward encrypted packets. |
| Which of the following methods of account creation does your app support? | **My app does not allow users to create an account.** Pairing is not an account: there is no username, password or server-side profile. |
| Do you provide a way for users to request that their data is deleted? | **Yes.** All data is on the user's devices: Settings → "Forget connection" deletes the pairing and the cache; uninstalling deletes everything; the backend's data stays under the user's control on their own computer. The developer holds no data to delete. Link for the "delete data" URL, if asked: https://maxgierlachowski.github.io/hermes-ui/privacy/#deletion |

## Section 2: Data types (only with "Yes")

All data types (Location, Personal info, Financial info, Health and fitness, Messages, Photos and
videos, Audio files, Files and docs, Calendar, Contacts, App activity, Web browsing, App info and
performance, Device or other IDs): **not collected, not shared** – with the possible exception of
*Device or other IDs* in the conservative alternative above.

Notes for the data types that look relevant at first sight:

- **Messages, Photos, Audio:** the app handles them, but sends them end-to-end encrypted only to the
  user's own backend → exempt.
- **App activity / In-app search history:** search runs on the user's backend, over the same encrypted
  connection → exempt.
- **App info and performance (crash logs, diagnostics):** the app has no crash reporting SDK.

## Push via Firebase (FCM): how to answer

The app can deliver notifications while it is closed through **Firebase Cloud Messaging** – but only
when it is **built** with a `google-services.json` (`GOOGLE_SERVICES_JSON`) and the backend has the
matching Firebase service account. That works for someone who builds the app **with their own
Firebase project**. It does not fit a store build:

- A store build can only contain **one** Firebase project – the maintainer's. Every user's backend would
  then need the maintainer's service-account key to send pushes, which is impossible to hand out safely.
  The only way around it would be a push relay operated by the maintainer, i.e. a developer server that
  receives device tokens and notification texts – exactly what this app avoids.
- Therefore the recommended store build ships **without Firebase**. Background delivery uses the local
  keep-alive service instead ([foreground-service.md](foreground-service.md)), and "Enable push (FCM)" in
  Settings reports that this build has no Firebase. The answers above apply.

If a store build **does** include Firebase (maintainer's project) in the future, the answers change:

| Item | Answer then |
|---|---|
| Collects or shares data? | **Yes** |
| Data type | **Device or other IDs**: the FCM registration token / Firebase installation ID, transmitted by the Firebase SDK to Google and by the app to the user's backend |
| Shared? | No, if Google acts as service provider for message delivery (Firebase's own Data-safety guidance describes FCM this way); the transfer to the user's backend is user-initiated |
| Purpose | App functionality (notifications) |
| Optional? | Yes – push is off until the user enables it in Settings |
| Notification content | The backend sends only the chat title and a fixed label ("Approval needed", "Done", "Error"), never message text; it passes through Google's FCM servers (TLS-encrypted, not end-to-end) |
| Encrypted in transit | Yes |

Then also update the privacy policy (section "Push notifications") and the App Store privacy label
([../apple/app-privacy.md](../apple/app-privacy.md)).

For a **self-built** app with the user's own Firebase project, the user is the developer of that build
and the data stays in their own project; nothing changes for the store listing.

## Other App content items (for completeness)

| Item | Draft |
|---|---|
| Privacy policy | https://maxgierlachowski.github.io/hermes-ui/privacy/ |
| Ads | No, the app contains no ads |
| App access | see [../review-notes.md](../review-notes.md#google-play-app-access) |
| Content rating (IARC) | Category "All other app types". Violence, sexuality, language, controlled substances, gambling: no. Users can interact or exchange content with other users: **No** (the app connects to the user's own agent only). Shares the user's location: No. Digital purchases: No. Unrestricted internet access (web browser / search engine): No – but see the AI note in [../apple/app-privacy.md](../apple/app-privacy.md#age-rating-questionnaire-draft) |
| Target audience | 18 and over (a developer tool; avoids the Families policy) |
| News app / Health app / Financial features / Government app | No |
| Foreground service permissions | see [foreground-service.md](foreground-service.md) |
| Data deletion URL (only asked with accounts) | not applicable – no accounts |
