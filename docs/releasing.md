# Releasing the mobile app

How to get the app from this repository into Google Play and the App Store under **your own** accounts.
Nothing here needs a service of the project: every account, key and listing is yours.

Related: [mobile-app.md](mobile-app.md) (build, signing, pairing, push) ·
[secrets-and-state.md](secrets-and-state.md) (what to back up) · [`store/`](../store/README.md)
(listing texts, review notes, privacy answers, graphics) · [`CHANGELOG.md`](../CHANGELOG.md).

> Facts about store rules were checked on 2026-11-19. Stores change their rules often; check the
> linked pages again before the first upload.

## 0. Decide first (cannot be changed later)

| Decision | Where | Why it is permanent |
|---|---|---|
| **App id** (`HERMES_UI_APP_ID`, e.g. `com.example.hermesui`) | `mobile-app/.env` | Play package names and iOS bundle ids are permanent once uploaded. A different id is a different app: users reinstall, reviews and installs start from zero. Use reverse DNS of a domain you own. The default `app.hermesui.mobile` is fine for local builds, but you do not own `hermesui.app`. |
| **Store name** | `HERMES_UI_APP_NAME`, `store/listing/*.md` | The name can change later, but the first one shapes the listing. See [Naming](#naming). |
| **Upload key** | `mobile-app/.secrets/` | Updates must be signed with it. With Play App Signing a lost upload key can be reset through Google support, but the old key is still what installed APKs outside Play check. Back it up now ([secrets-and-state.md](secrets-and-state.md)). |

Changing the app id later also means the sideloaded APKs (`mobile-app-v0.x` pre-releases) cannot update
to the store version: uninstall them first.

## Naming

"Hermes" and "Hermes Agent" are Nous Research's names. As of 2026-11-19:

- **Nous Research has its own app, "Hermes Mobile"** (beta via TestFlight / Firebase since ~2026-10-30,
  not in the public stores yet). Do not use "Hermes Mobile" and do not look official.
- More than ten third-party clients exist, several with the pattern "… for Hermes Agent" (App Store:
  "Hermes Client for Hermes Agent", "Companion for Hermes Agent", "ERMIS - Client for Hermes", "Hermex",
  "HermesPilot", "Hermes Conduit", "Hermes HQ"; Play: "Hermes Agent WebUI", "Pomelu for Hermes Agent",
  "Hermes-Relay", "Hermes Mobile: AI Agent Leash", …). Apple lets the pattern through.
- No store app is called exactly "Hermes UI". The npm name `hermes-ui` is taken (an empty placeholder
  from 2024), so the backend is not published to npm under that name.
- Other risks: "HERMES" is a famous mark of Hermès International, there is a pending US application
  "HERMES" for AI chatbot software (class 9/42), and React Native's JavaScript engine is called Hermes.
- Apple 4.1 / 5.2.1 and Google's impersonation policy forbid implying an affiliation.

**Recommendation:** an own product name as the title, "for Hermes Agent" only in the subtitle /
short description, and in every listing: *"Unofficial client. Not affiliated with or endorsed by Nous
Research."* (already in `store/listing/`). Check the name in the USPTO, EUIPO (TMview) and WIPO
databases before you settle on it. Renaming the repo or the app is a separate decision.

## 1. Accounts

### Apple Developer Program (US$99 / year)

- **Individual:** enrol with your Apple Account and an ID check; your legal name is shown as the seller.
  No D-U-N-S number needed. Good for a personal project.
- **Organisation:** needs a legal entity, a **D-U-N-S number** (free, takes days to weeks), a domain
  e-mail address and a public website. The company name is shown as the seller.
- **EU Digital Services Act:** App Store Connect asks whether you are a *trader*. As an individual
  trader your address, phone and e-mail are shown on EU product pages; as a non-trader nothing is shown,
  but you may not act commercially.
- Then: Certificates, Identifiers & Profiles → **Identifiers** → register the bundle id
  (`HERMES_UI_APP_ID`) with the capabilities **Push Notifications** and, if you use verified links,
  **Associated Domains**. Note the **Team ID** (Membership page) → `HERMES_UI_APPLE_TEAM_ID`.

### Google Play Console (US$25 once)

- **Personal account:** identity check with an ID and a card in your name. Accounts created after
  2023-11-13 must run a **closed test with at least 12 testers who stay opted in for 14 consecutive
  days** before applying for production. Plan about three weeks for the first launch. Organisation
  accounts (D-U-N-S) are exempt.
- Create the app (name, default language, app or game: app, free).
- **Play App Signing** is mandatory for app bundles: Google keeps the app signing key, you upload with
  your **upload key** = the keystore in `mobile-app/.secrets/`. On first upload, choose "Use Google-
  generated key".

### Firebase (optional: push with the app closed)

1. console.firebase.google.com → new project (no Analytics needed).
2. Add an **Android app** with the package name `HERMES_UI_APP_ID` → download `google-services.json`
   → keep it in `mobile-app/.secrets/` and set `GOOGLE_SERVICES_JSON` to its path.
3. Project settings → Service accounts → **Generate new private key** → keep the JSON outside the repo
   and set `HERMES_UI_FCM_SERVICE_ACCOUNT` for the backend.
4. iOS (later): FCM can deliver to iOS through APNs: upload an APNs auth key (.p8, from the Apple
   developer account) in Firebase → Cloud Messaging, add an iOS app and set `GOOGLE_SERVICES_PLIST`.
5. **App Distribution** (optional): distribute APKs to testers without Play: Firebase → App
   Distribution → upload `dist/*-arm64-v8a.apk`.

## 2. Files and keys: what goes where

| What | Where it lives (never in git) | Used by |
|---|---|---|
| Upload keystore + `keystore.properties` | `mobile-app/.secrets/` | Gradle release signing |
| Play service account JSON | `mobile-app/.secrets/play-service-account.json` | `eas submit`, CI upload |
| App Store Connect API key (.p8 + key id + issuer id) | `mobile-app/.secrets/AuthKey_<id>.p8` | `eas submit`, Xcode/Transporter |
| `google-services.json` | `mobile-app/.secrets/`, path in `GOOGLE_SERVICES_JSON` | app build (FCM) |
| Firebase service account | outside the repo, `HERMES_UI_FCM_SERVICE_ACCOUNT` | backend (sends push) |
| App identity | `mobile-app/.env` (from `.env.example`) | `app.config.ts` |

`scripts/export-secrets.sh` puts all of these into one encrypted backup.

### GitHub Actions secrets (optional, for CI releases)

`.github/workflows/android.yml` builds on a tag `mobile-app-v*`. Without secrets it produces
debug-signed artifacts; with them it signs, attaches the files to a draft pre-release and uploads the
AAB to Play's internal track:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i mobile-app/.secrets/release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | from `keystore.properties` |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Console → Setup → API access → service account with "Release to testing tracks" |
| `GOOGLE_SERVICES_JSON` | content of `google-services.json` |

Repository **variables**: `HERMES_UI_APP_ID`, `HERMES_UI_APP_NAME`, `HERMES_UI_LINK_HOST`, `HERMES_UI_LINK_PATH`.

## 3. Version and build number

One place: [`mobile-app/version.json`](../mobile-app/version.json) — `version` (shown to users,
`0.3.0`) and `build` (Android `versionCode`, iOS `CFBundleVersion`; must grow with every upload).
Raise both for a release, add a section to `CHANGELOG.md`, tag `mobile-app-vX.Y.Z`.
EAS cloud builds keep their own counter (`appVersionSource: remote`, `autoIncrement` in the production
profile); after the first EAS build run `eas build:version:set` once to start it at `build`.

## 4. Build

Prerequisites: `scripts/bootstrap.sh --mobile` ([development.md](development.md)).

### Android (local, recommended)

```bash
cd mobile-app
npm run release:android     # Rust lib → prebuild → AAB + one APK per ABI → dist/ (+ SHA-256 list)
```

Check the signature: `keytool -printcert -jarfile dist/hermes-ui-<v>-<b>-arm64-v8a.apk` must show your
upload key (SHA-256 also in `store/templates/` for `assetlinks.json`).

### iOS (local, Xcode)

```bash
cd mobile-app
npm run iroh:ios
npx expo prebuild --platform ios --clean && (cd ios && pod install)
open ios/HermesUI.xcworkspace   # Signing & Capabilities: your team; Product → Archive → Distribute
```

Uploads need Xcode 26+ with the iOS 26 SDK (Apple's rule since 2026-04-28).

### EAS (Expo's cloud builder, optional)

`mobile-app/eas.json` has profiles `development` (dev client), `preview` (internal APK) and
`production` (AAB / App Store archive). The native Rust library is built on the build machine by the
`eas-build-post-install` hook (`scripts/eas-build-post-install.sh`, installs rustup + targets). Untested
in the cloud so far; `eas build --local` runs the same steps on your machine.

```bash
npm i -g eas-cli && eas login && eas init          # writes the project id → EAS_PROJECT_ID
eas build -p android --profile production
eas submit -p android --profile production         # needs the Play service account JSON
```

## 5. First upload

### Google Play

1. Play Console → your app → **Test and release → Internal testing** → create release → upload
   `dist/hermes-ui-<v>-<b>.aab` → release notes from `store/listing/*.md`.
2. **App content** (all required before review): privacy policy URL
   (`https://<you>.github.io/hermes-ui/privacy/`), app access (→ `store/review-notes.md`: "Try the
   demo" needs no login), ads: no, content rating questionnaire, target audience (18+ or 13+; not for
   children), data safety (→ `store/play/data-safety.md`), government app: no, financial features: no,
   health: no, **foreground service permissions** (→ `store/play/foreground-service.md`, with the video).
3. **Store listing**: texts from `store/listing/`, icon `store/graphics/icon-512.png`, feature graphic
   `store/graphics/feature-graphic.png`, phone + tablet screenshots `store/screenshots/`.
4. Closed testing (personal accounts): a track with ≥ 12 testers (a Google Group or e-mail list),
   14 days continuously opted in, then **Apply for production**.

### App Store

1. App Store Connect → Apps → **+** → new app: platform iOS, name, primary language, bundle id, SKU.
2. **App Privacy**: answers in `store/apple/app-privacy.md` ("Data Not Collected"); privacy policy URL.
3. **Export compliance**: the iroh library brings its own TLS 1.3 / QUIC (rustls) = standard algorithms
   outside Apple's OS. Answer *uses encryption: yes → standard algorithms*; App Store Connect then wants
   the **French encryption declaration** only if the app is offered in France (or leave France out).
   The build sets `ITSAppUsesNonExemptEncryption = true` (`HERMES_UI_IOS_NON_EXEMPT_ENCRYPTION`) so this
   is answered once per app, not per build. Details and the US self-classification question:
   `store/apple/app-privacy.md`.
4. Archive in Xcode → Distribute App → App Store Connect (or Transporter) → **TestFlight**: internal
   testers (up to 100, no review) right away; external testers after a short beta review.
5. **App Review**: review notes from `store/review-notes.md`. The app needs a self-hosted backend, so
   reviewers use **Try the demo** on the first screen. Guideline 2.1 says a demo mode "in lieu of a
   demo account" needs Apple's prior approval: ask in the notes (text prepared), and be ready to offer
   a demo backend if they insist.

## 6. Store-specific details

### Foreground service (Android)

"Stay connected in the background" runs a foreground service while the agent works on a chat (default)
or always. Type **`dataSync`** by default (Play: "transfer data between device and network"; Android 15+
limits it to 6 h per 24 h, the service stops itself at the limit and restarts with the next app
start). Alternatives via `HERMES_UI_FGS_TYPE`: `remoteMessaging` (no time limit, but Google describes it
as message continuity between devices) or `specialUse` (free-text subtype, reviewed strictly). The
declaration text and the video shot list are in `store/play/foreground-service.md`. Without the service,
or if Google rejects it: push through FCM.

### Permissions

| Permission | Why | Asked |
|---|---|---|
| Camera | scan the pairing QR code, photos for a chat | on first scan |
| Microphone | voice messages | on first recording |
| Photos | attach images (Android uses the system photo picker: no storage permission) | iOS on first pick |
| Notifications | replies and approvals | Settings → test notification |
| Foreground service (dataSync) | keep-alive, see above | — |
| iOS local network | direct connection when backend and phone share a network | on the first direct path |

No "Nearby devices" permission: at target SDK 36 local network access needs none. Android 17
(target 37, expected as Play requirement around August 2027) blocks LAN access without the new runtime
permission `ACCESS_LOCAL_NETWORK`; the relay path keeps working without it. Blocked on purpose:
storage, overlay, background media playback, biometrics.

### Verified pairing links (optional)

Pairing links are `https://<ui-host>/<path>/#iroh=…`. To open them in the app without a chooser
(Android App Links, iOS Universal Links) you need a domain whose **root** you control:
`/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` (templates in
`store/templates/`). A GitHub *project* page (`<you>.github.io/hermes-ui`) cannot serve the root, a
custom domain can. Then set `HERMES_UI_VERIFIED_LINK_HOST`.

## 7. Release checklist

- [ ] `mobile-app/version.json`: version + build raised; `CHANGELOG.md` section
- [ ] `npm run verify` and `npm run test:ui` green
- [ ] `npm run release:android` → AAB + APKs signed with the upload key
- [ ] Demo mode checked on a phone (pairing screen → Try the demo)
- [ ] Tag `mobile-app-vX.Y.Z`, push; pre-release with APKs + AAB + SHA-256 list
- [ ] Play: internal → closed → production; App Store: TestFlight → review
