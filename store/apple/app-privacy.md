# App Store Connect – App Privacy, export compliance, age rating, content rights (drafts)

Answers for the iOS build as it is meant to ship: **without Firebase and without remote push**
(no `GOOGLE_SERVICES_PLIST`), notifications only while the app runs. What changes with push is
described in each section.

## 1. App Privacy ("nutrition label")

App Store Connect → App → *App Privacy* → *Get Started*.

**Do you or your third-party partners collect data from this app?**
→ **No, we do not collect data from this app.** Result on the product page: **"Data Not Collected"**.

Apple's definition: "collect" = transmit data off the device in a way that allows you and/or your
third-party partners to access it for longer than needed to service the request in real time. Why the
answer is "No":

| Data | Where it goes | Collected in Apple's sense? |
|---|---|---|
| Messages, photos, voice recordings, search queries | only to the backend **the user runs on their own computer**, end-to-end encrypted (QUIC/TLS 1.3 over iroh) | No: neither the developer nor a partner can access it. Apple's guidance excludes data the developer cannot read; the backend is the user's own system. |
| Pairing data, device key | Keychain on the device | No (on-device only) |
| Cache (board, recent messages, media ≤ 200 MB), settings | app container on the device | No (on-device only) |
| iroh endpoint id (random public key), IP address | the relay chosen by the user's backend (n0's public relays or the user's own) and n0's discovery service, to route encrypted packets | No: transport metadata processed in real time to deliver the connection; it does not reach the developer, and no partner of the developer receives it for any other purpose |
| Demo mode | nothing leaves the device | No |
| Analytics, crash reporting, ads, attribution SDKs | none in the app | – |

The build's privacy manifest matches this: `NSPrivacyTracking = false`, no tracking domains,
`NSPrivacyCollectedDataTypes = []` (set in `app/app.config.ts`), plus the required-reason API
declarations.

**Tracking (ATT):** the app does not track. No `NSUserTrackingUsageDescription`, no IDFA.

### What changes if remote push is enabled

Remote push on iOS needs an APNs key of the developer's Apple team (directly or through Firebase).
Like on Android, a self-hosted backend cannot hold the maintainer's key, so remote push in a store
build would require a **push relay operated by the maintainer** that receives device tokens and the
notification texts. If that ever happens, answer **"Yes, we collect data"** and declare:

| Data type | Linked to the user? | Tracking? | Purpose |
|---|---|---|---|
| Identifiers → **Device ID** (APNs device token; with Firebase also the Firebase installation ID / FCM token) | Not linked to identity (no account), but linked to the device | No | App Functionality |
| User Content → **Other User Content** (chat title + fixed label such as "Approval needed" passing the relay) – only if the relay can read it | Not linked | No | App Functionality |

With Firebase in the build, also add Firebase's own required-reason entries to the privacy manifest
(the Firebase SDKs ship a manifest of their own) and update the privacy policy and the Play Data
safety form ([../play/data-safety.md](../play/data-safety.md#push-via-firebase-fcm-how-to-answer)).

A self-built app with the user's own Apple team and backend changes nothing for the store listing.

## 2. Export compliance (encryption)

The app ships its own cryptography: the iroh library (Rust) brings QUIC with **TLS 1.3 via rustls**
(standard algorithms: X25519, Ed25519, AES-GCM / ChaCha20-Poly1305, SHA-2), independent of Apple's
frameworks. That is "non-exempt" in Apple's wording, so the build declares it:

- `Info.plist`: `ITSAppUsesNonExemptEncryption = YES`, set in `app.config.ts` from
  **`HERMES_UI_IOS_NON_EXEMPT_ENCRYPTION=true`** (the default). Keep it `true` for store builds.
- With the key in the Info.plist, App Store Connect asks the questions once per app (not per build).

Draft answers to App Store Connect's questions (wording varies slightly between versions of the form):

| Question | Answer |
|---|---|
| What type of encryption algorithms does your app implement? | **Standard encryption algorithms instead of, or in addition to, using or accessing the encryption within Apple's operating system** |
| Does your app use proprietary or non-standard encryption algorithms? | **No** (only IETF/NIST standards: TLS 1.3, QUIC, X25519, Ed25519, AES-GCM, ChaCha20-Poly1305) |
| Purpose | Securing the communication channel between the app and the user's own server (data in transit). No encryption of data at rest beyond the OS, no encryption offered to the user as a feature. |
| Is your app going to be available on the App Store in France? | Decision for the maintainer, see below |

US export law (for the maintainer's information, not legal advice): an app that uses standard
cryptography only to secure its own communications is typically classified **5D992.c (mass market)**;
the source code is also publicly available (MIT). Under the current EAR, mass-market items of this kind
generally need **no** classification request (CCATS) and, since 2021, no annual self-classification
report for most cases. App Store Connect may still ask for documentation; if it does, the answer is the
mass-market classification above. Verify the current state of 15 CFR 740.17 / 742.15 before the first
submission.

**France:** France regulates the supply of cryptology means (ANSSI). When the app is distributed in
France with non-exempt encryption, App Store Connect asks for the **French encryption declaration**.
Options:

1. File the declaration with ANSSI ("déclaration de fourniture d'un moyen de cryptologie") and upload
   the receipt in App Store Connect. Free, but a formal process in French that can take weeks.
2. Exclude France from the app's availability until the declaration exists.

Recommendation: start with option 2 for the first release, file the declaration in parallel.

## 3. Age rating questionnaire (draft)

App Store Connect → App Information → *Age Rating*. The app itself generates nothing: it shows the
conversation between the user and **their own** AI agent, running on their own computer, with the
models and tools the user chose. It contains no content of its own besides the built-in demo data
(harmless sample tasks).

| Section / question | Literal answer | Note |
|---|---|---|
| Parental controls | No | |
| Age assurance | No | |
| Unrestricted web access | **No** | The app contains no browser and no web search. Links in messages open in the system browser. |
| User-generated content | **No** | Users don't see content from other users. The only content is the user's own conversation with their own agent. |
| Messaging and chat (with other users) | **No** | The "chat" is with the user's own agent, not with other people. Chats that came in through e.g. Slack show the user's own agent history only. |
| Advertising | No | |
| Profanity or crude humour, horror/fear, mature or suggestive themes, violence (cartoon / realistic / graphic), sexual content or nudity, alcohol/tobacco/drugs, simulated gambling, contests, medical or treatment information, guns/weapons | **None** | for content generated **by the app** |
| Gambling / loot boxes | No | |

Honest caveat: the agent's replies are AI-generated text from a model the user chose and configured.
The app neither filters nor moderates them; it cannot know what a self-hosted model produces.

- If the questionnaire asks whether the app **includes AI-generated content or an AI
  assistant/chatbot**: answer **Yes** and explain in the notes that the AI runs on the user's own
  computer, under the user's control, and that the app is a client for it.
- Literal answers give the lowest rating. Because the target audience is developers and the agent's
  output is not moderated, it is defensible – and avoids any discussion under guideline 1.2 – to pick the
  **higher rating**: if the form offers an age-rating override, choose the highest one (18+);
  otherwise accept what the literal answers give and mention the self-hosted AI in the review notes
  (already done in [../review-notes.md](../review-notes.md)).

Recommendation: literal answers, plus the 18+ override if available. On Google Play, set the target
audience to 18+ for the same reason ([../play/data-safety.md](../play/data-safety.md#other-app-content-items-for-completeness)).

## 4. Content rights

App Store Connect → App Information → *Content Rights*:

**Does your app contain, show, or access third-party content?**
→ **No.**

Reasoning: the app shows only the user's own data from the user's own backend; the demo data was
written for this project; the icon and texts are original. The bundled open-source libraries are
software under their licences, not "content" in this sense. "Hermes Agent", "Nous Research" and
"Paseo" appear only as names to describe compatibility, with the non-affiliation disclaimer in the
description.

If you prefer the cautious answer ("Yes", because the app displays content from a third-party
product): then also answer "Yes, I have the necessary rights" – the content belongs to the user.

## 5. Related App Store Connect settings

| Item | Value |
|---|---|
| Privacy Policy URL | https://maxgierlachowski.github.io/hermes-ui/privacy/ (de: …/privacy/de/) |
| User Privacy Choices URL (optional) | leave empty – there are no choices to make, nothing is collected |
| Sign-in required | No |
| Account deletion (5.1.1(v)) | not applicable – no accounts |
| EU Digital Services Act: trader status | Decide: a private individual offering a free app without commercial intent may declare "not a trader"; a trader must publish address, phone and e-mail ({{PROVIDER_NAME}}, {{PROVIDER_ADDRESS}}, {{CONTACT_EMAIL}}) on the product page |
| Encryption | see section 2; `ITSAppUsesNonExemptEncryption = YES` |
