# store/ – App Store and Google Play material

Everything needed to fill in App Store Connect and the Play Console for the mobile app
(`app/`), except screenshots. Nothing here is uploaded automatically; copy the texts in by hand.

The working name is **Hermes UI** (store title pattern `<Name> for Hermes Agent` / `<Name> für Hermes
Agent`). Each file sets the store-visible name in one place (marked there); the other texts say "the
app". Every listing carries the disclaimer that the app is unofficial and not affiliated with or
endorsed by Nous Research.

Placeholders used throughout: `{{PROVIDER_NAME}}`, `{{PROVIDER_ADDRESS}}`, `{{CONTACT_EMAIL}}`, and for
the link templates `{{ANDROID_PACKAGE}}`, `{{IOS_BUNDLE_ID}}`, `{{APPLE_TEAM_ID}}`,
`{{SHA256_CERT_FINGERPRINT}}`.

## Contents

| Path | What |
|---|---|
| [`listing/en.md`](listing/en.md), [`listing/de.md`](listing/de.md) | Store texts per language: name/title, subtitle, short description, promotional text, description, keywords, "What's new" 0.3.0, URLs, category |
| [`review-notes.md`](review-notes.md) | App Review notes (Apple), request to approve the demo mode instead of a demo account (guideline 2.1), Play "App access" instructions |
| [`play/data-safety.md`](play/data-safety.md) | Play Data safety form, question by question, with the reasoning; how FCM push changes it; other App content items |
| [`play/foreground-service.md`](play/foreground-service.md) | Play foreground service declaration (`remoteMessaging`), texts, shot list for the demo video, fallbacks |
| [`apple/app-privacy.md`](apple/app-privacy.md) | App Privacy label ("Data Not Collected"), export compliance, age rating, content rights |
| [`templates/`](templates/README.md) | `assetlinks.json` and `apple-app-site-association` for verified pairing links, and where to host them |
| [`graphics/`](graphics) | `icon-1024.png` (App Store, 1024×1024, RGB without alpha), `icon-512.png` (Play, 512×512), `feature-graphic.png` (Play, 1024×500, RGB without alpha) |

The privacy policy and support page live in [`../site/`](../site/README.md) and are published with the
web UI on GitHub Pages.

## Where each text goes

### App Store Connect

| Field (App Store Connect) | Location | Source |
|---|---|---|
| Name | App Information (per localisation) | `listing/*.md` → `apple.name` |
| Subtitle | App Information (per localisation) | `apple.subtitle` |
| Privacy Policy URL | App Information (per localisation) | `listing/*.md` → URLs |
| Category | App Information | `listing/*.md` → Category |
| Content Rights, Age Rating | App Information | `apple/app-privacy.md` §3–4 |
| App Encryption Documentation | App Information | `apple/app-privacy.md` §2 |
| App Privacy | App Privacy | `apple/app-privacy.md` §1 |
| Promotional Text | Version page (changeable any time) | `apple.promo` |
| Description | Version page | `description` |
| Keywords | Version page | `apple.keywords` |
| Support URL, Marketing URL | Version page | URLs |
| What's New in This Version | Version page (not for the very first version; keep it for 0.3.1+) | `whatsnew` |
| App Review Information → Notes, Sign-in required: off | Version page | `review-notes.md` |
| App icon | from the build (`app/assets/images/icon.png`); `graphics/icon-1024.png` is the same artwork, full bleed, without alpha, for anywhere a 1024 px icon is asked for | `graphics/` |

### Google Play Console

| Field (Play Console) | Location | Source |
|---|---|---|
| App name | Grow users → Store presence → Main store listing | `play.title` |
| Short description | Main store listing | `play.short` |
| Full description | Main store listing | `description` |
| App icon | Main store listing | `graphics/icon-512.png` |
| Feature graphic | Main store listing | `graphics/feature-graphic.png` |
| Category, contact e-mail, website | Store settings | `listing/en.md` → URLs, Category |
| Privacy policy | Policy → App content | URLs |
| App access | Policy → App content | `review-notes.md` |
| Data safety, ads, content rating, target audience | Policy → App content | `play/data-safety.md` |
| Foreground service permissions | Policy → App content | `play/foreground-service.md` |
| Release notes | Test and release → release → Release notes (`<en-US>…</en-US>`, `<de-DE>…</de-DE>`) | `whatsnew` |

## Character limits

| Store | Field | Limit | Key in the files |
|---|---|---:|---|
| Apple | App name | 30 | `apple.name` |
| Apple | Subtitle | 30 | `apple.subtitle` |
| Apple | Promotional text | 170 | `apple.promo` |
| Apple | Keywords (comma-separated) | 100 | `apple.keywords` |
| Apple | Description | 4000 | `description` |
| Apple | What's New | 4000 | `whatsnew` (kept ≤ 500 for Play) |
| Apple | App Review notes | 4000 | `apple.review-notes` |
| Play | Title | 30 | `play.title` |
| Play | Short description | 80 | `play.short` |
| Play | Full description | 4000 | `description` |
| Play | Release notes (per language) | 500 | `whatsnew` |
| Play | App access, other information | not documented; kept ≤ 500 | `play.app-access` |
| Play | Foreground service texts | not documented; kept ≤ 1000 | `play.fgs.*` |

All texts respect these limits. Current counts (characters as Unicode code points; bytes in UTF-8
for reference, Apple's keyword field is sometimes reported to count bytes – both are below 100):

| File | Field | Characters | Limit |
|---|---|---:|---:|
| `listing/en.md` | apple.name / play.title | 26 | 30 |
| | apple.subtitle | 30 | 30 |
| | play.short | 73 | 80 |
| | apple.promo | 138 | 170 |
| | description | 2671 | 4000 |
| | apple.keywords | 98 (98 bytes) | 100 |
| | whatsnew | 317 | 500 |
| `listing/de.md` | apple.name / play.title | 26 | 30 |
| | apple.subtitle | 30 | 30 |
| | play.short | 79 | 80 |
| | apple.promo | 148 | 170 |
| | description | 3073 | 4000 |
| | apple.keywords | 96 (97 bytes) | 100 |
| | whatsnew | 398 | 500 |
| `review-notes.md` | apple.review-notes | 3746 | 4000 |
| | play.app-access | 411 | 500 |
| `play/foreground-service.md` | play.fgs.feature | 748 | 1000 |
| | play.fgs.impact | 584 | 1000 |

### Checking the lengths

Every length-limited text sits in a fenced `text` block right after a marker
`<!-- field: <key> max=<limit> -->`. After any edit, run from the repository root:

```bash
node - store/listing/*.md store/review-notes.md store/play/foreground-service.md <<'EOF'
const { readFileSync } = require('node:fs')
let over = 0
for (const f of process.argv.slice(2)) {
  const s = readFileSync(f, 'utf8')
  for (const [, key, max, text] of s.matchAll(/<!-- field: (\S+) max=(\d+) -->\s*```text\n([\s\S]*?)\n```/g)) {
    const chars = [...text].length, bytes = Buffer.byteLength(text)
    if (chars > +max) over++
    console.log(`${chars <= +max ? 'ok  ' : 'OVER'}  ${f.padEnd(34)} ${key.padEnd(20)} ${String(chars).padStart(4)} / ${max}  (${bytes} bytes)`)
  }
}
process.exitCode = over ? 1 : 0
EOF
```

It exits with status 1 if any field is over its limit.

## Graphics

- `icon-1024.png` and `icon-512.png` are rendered from the same vector as `web/public/favicon.svg` and
  `app/assets/images/icon.png` (white "H" on `#6366f1`), **full bleed** without rounded corners:
  both stores apply their own mask. Saved as 8-bit RGB PNG, no alpha channel
  (`sips -g hasAlpha store/graphics/*.png` → `no`).
- `feature-graphic.png`: 1024×500, RGB, the icon, the name, the tagline "Your Hermes Agent, in your
  pocket." and an abstract board in zinc tones, Geist font. It contains the name: re-render it after a
  rename.
- Screenshots are not included yet: take them in demo mode (light and dark), so no real chats appear.

## Before submitting

- Fill in the placeholders here and in `../site/`.
- Make sure `docs/self-hosting.md` exists on `main`: the review notes, the support page and the Play
  App access text link to it.
- Publish `../site/` (merge to `main`; the Pages workflow copies it) and open both URLs once.
- Store build without Firebase (`GOOGLE_SERVICES_JSON` / `GOOGLE_SERVICES_PLIST` unset): the privacy
  answers assume it. `HERMES_UI_IOS_NON_EXEMPT_ENCRYPTION` stays `true`.
