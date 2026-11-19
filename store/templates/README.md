# Verified links (Android App Links, iOS Universal Links) – templates

Pairing links look like `https://<host>/#iroh=…&relay=…&pair=…` (UI at the domain root) or
`https://<host>/hermes-ui/#iroh=…` (UI below a path, as on GitHub Pages). The part after `#` never
reaches a web server. With **verified** links, tapping such a link (or scanning its QR code with the
system camera) opens the app directly instead of the browser, without the "Open with" chooser.

Without verified links everything still works: the app scans QR codes itself, accepts pasted links and
the `hermesui://pair?…` scheme, and on Android it offers to open `https://maxgierlachowski.github.io/hermes-ui/…`
links through an unverified intent filter (the user picks the app once).

## Files

| File | Platform | Placeholders |
|---|---|---|
| [`assetlinks.json`](assetlinks.json) | Android App Links | `{{ANDROID_PACKAGE}}` = `HERMES_UI_ANDROID_PACKAGE`; `{{SHA256_CERT_FINGERPRINT}}` = SHA-256 of the **app signing key** (Play Console → *Test and release → App integrity → App signing*, not the upload key; for a self-signed APK: `keytool -list -v -keystore mobile-app/.secrets/release.keystore`). Format `AB:CD:…`, upper case. Add a second fingerprint to the array for debug or sideloaded builds if needed. |
| [`apple-app-site-association`](apple-app-site-association) | iOS Universal Links | `{{APPLE_TEAM_ID}}` = the 10-character team ID; `{{IOS_BUNDLE_ID}}` = `HERMES_UI_IOS_BUNDLE_ID` |

Both templates match **only** pairing links: path `/` (UI at the root) or `/hermes-ui/*` (UI below
`/hermes-ui/`), each with a fragment starting with `iroh=`. Delete the component you don't need, or
change `/hermes-ui/*` to your path.

- **iOS:** `components` with a `"#"` key match on the fragment (iOS 13+), so the rest of the host keeps
  opening in Safari.
- **Android:** the `dynamic_app_deep_link_components` block (with fragment matching and the final
  `exclude` rule) is honoured on **Android 15+** only. Older Android versions verify the host as a whole
  and route by the app's intent filter, which (see `app.config.ts`, `HERMES_UI_VERIFIED_LINK_HOST`)
  matches every path of that host. Use a host that serves nothing but the UI, or both behave the same.
  Check Google's current documentation of the dynamic App Links format before relying on it.

## Where they must be hosted

| File | URL | Requirements |
|---|---|---|
| `assetlinks.json` | `https://<host>/.well-known/assetlinks.json` | HTTPS, `Content-Type: application/json`, no redirect, publicly reachable |
| `apple-app-site-association` | `https://<host>/.well-known/apple-app-site-association` | HTTPS, **no file extension**, `Content-Type: application/json`, no redirect, ≤ 128 KB; Apple fetches it through its CDN when the app is installed (and caches it) |

`<host>` is the host of the pairing links, i.e. the URL configured as `HERMES_UI_URL` on the backend.

**A GitHub *project* page cannot do this.** `https://maxgierlachowski.github.io/hermes-ui/` lives
below `/hermes-ui/`; the `/.well-known/` directory of `maxgierlachowski.github.io` belongs to the
*user* page repository (`<user>.github.io`), not to this project. Verified links therefore need either

1. **an own domain** for the UI (e.g. `hermes.example.org` as a GitHub Pages custom domain, or any static
   host), with both files under `/.well-known/` of that domain – recommended; or
2. the user-page repository `<user>.github.io` serving `/.well-known/…` for the whole
   `<user>.github.io` host (works, but ties the app to that account's user page).

On GitHub Pages, `.well-known` is published only if the site is not processed by Jekyll: add an empty
`.nojekyll` file at the root of the published directory (Jekyll skips dot-directories). GitHub Pages
serves `apple-app-site-association` without an extension as `application/octet-stream`; Apple accepts
that in practice, but a host that lets you set `Content-Type: application/json` is the safer choice.

## Building the app for a verified host

```bash
HERMES_UI_VERIFIED_LINK_HOST=hermes.example.org \
HERMES_UI_APPLE_TEAM_ID={{APPLE_TEAM_ID}} \
HERMES_UI_ANDROID_PACKAGE={{ANDROID_PACKAGE}} HERMES_UI_IOS_BUNDLE_ID={{IOS_BUNDLE_ID}} \
npx expo prebuild
```

This adds `applinks:<host>` to the iOS associated domains and an `autoVerify` intent filter on Android
(`mobile-app/app.config.ts`). Check after installing:

- Android: `adb shell pm get-app-links {{ANDROID_PACKAGE}}` → the host shows `verified`.
- iOS: Settings → Developer → *Universal Links* → *Diagnostics* with a pairing URL, or
  `https://app-site-association.cdn-apple.com/a/v1/<host>` to see what Apple's CDN has cached.
