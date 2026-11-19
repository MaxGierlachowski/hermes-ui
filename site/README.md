# site/ – static pages next to the web UI

The privacy policy and the support page that the store listings link to. The Pages workflow
(`.github/workflows/pages.yml`) builds the web UI into `web/dist` and then runs `cp -R site/. web/dist/`,
so everything in this directory ends up at the **root of the GitHub Pages site**, next to the web app:

| File | Published at |
|---|---|
| `privacy/index.html` | https://maxgierlachowski.github.io/hermes-ui/privacy/ |
| `privacy/de/index.html` | https://maxgierlachowski.github.io/hermes-ui/privacy/de/ |
| `support/index.html` | https://maxgierlachowski.github.io/hermes-ui/support/ |
| `support/de/index.html` | https://maxgierlachowski.github.io/hermes-ui/support/de/ |

## Never add files that collide with the web app

`cp` silently overwrites. Do **not** create any of these here (they are the web UI's build output):

`index.html`, `assets/`, `sw.js`, `iroh-sw.js`, `manifest.webmanifest`, `favicon.svg`,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png` – and generally nothing at the top level except
new sub-directories. Check against `ls web/dist` before adding anything.

This README is copied too (as `/README.md` on the site). That is harmless; to keep it off the site,
exclude it in the workflow (`rsync -a --exclude README.md site/ web/dist/`).

## Rules for the pages

- Self-contained: inline CSS only, light/dark through `prefers-color-scheme`, no external fonts,
  scripts, images, cookies or trackers (a check: open a page with the network tab open – zero requests
  besides the HTML itself).
- Relative links only (`../support/`, `de/`), so the pages also work below a custom domain or another
  path.
- The app name appears only in `<title>` and in the header (`<!-- APP NAME -->`); the texts say "the app".
- Placeholders to fill before publishing: `{{PROVIDER_NAME}}`, `{{PROVIDER_ADDRESS}}`,
  `{{CONTACT_EMAIL}}` (privacy: section 2 and contact; support: box and footer).
- Update the "Last updated" / "Stand" date in both privacy pages with every change of content, and keep
  English and German in sync.
- The pages reference `docs/self-hosting.md` on GitHub; keep that path stable.
