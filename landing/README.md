# landing/ – the website at the root of GitHub Pages

`index.html` is the product page at <https://maxgierlachowski.github.io/hermes-ui/>. The web UI moved
below it, to <https://maxgierlachowski.github.io/hermes-ui/app/>.

`scripts/build-pages.mjs` assembles the Pages site (`.github/workflows/pages.yml` runs it):

| Source | Published at |
|---|---|
| `landing/*` (without this README) | `/` |
| `web/dist` (built with `VITE_SW_PATH='../'`) | `/app/` |
| `web/dist/sw.js` with `self.HERMES_UI_APP_PATH = 'app/'` prepended, `iroh-sw.js`, icons | `/` |
| `site/*`, if the directory exists (privacy, support) | `/` |

The script refuses any file that would overwrite another one at the site root.

Local preview: `node scripts/build-pages.mjs` (or `--skip-build` after a build), then serve `_site/`
under `/hermes-ui/`, so that relative paths and the worker scope match GitHub Pages.

## Why the service worker stays at the root

Before the landing page, the UI lived at the root, and every install registered `/hermes-ui/sw.js` with
scope `/hermes-ui/`; Web Push subscriptions belong to that registration. The Pages build therefore keeps
the worker there: the UI under `/app/` registers `../sw.js` (`web/src/lib/sw-url.ts`), which is the same
registration, so pairing (localStorage, same origin) and push subscriptions carry over without anything
to do. `HERMES_UI_APP_PATH` tells the worker to open and focus `/app/` on a notification click. The
worker has no cache and no fetch handler besides iroh-fetch's (only iroh hosts), so it never serves the
landing page or a stale app.

Self-hosted builds (`npm run build`, backend serving `web/dist`) are unchanged: no `VITE_SW_PATH`, the
worker sits next to `index.html` and opens its own scope.

## What forwards to /app/

The first script in `index.html`, before anything renders, replaces the location with `app/` + query +
hash when

- the page runs as an installed app (`display-mode: standalone | fullscreen | minimal-ui |
  window-controls-overlay`, or iOS `navigator.standalone`): installs from before the move still start
  at the root;
- the hash is an app route (`#/…`, e.g. `#/inbox` from older notifications) or a pairing link
  (`#iroh=…&relay=…&pair=…`, from backends whose `HERMES_UI_URL` is still the root).

Plain visits to the root show the landing page. GitHub Pages caches HTML for up to 10 minutes, so an
old copy can show until then.

## Rules for the page

- Self-contained: inline CSS and JS, no external fonts, scripts, images, cookies or trackers. Geist is
  served from `assets/fonts/` (OFL, see `OFL-Geist.txt`).
- Light and dark through `prefers-color-scheme`; every screenshot exists in both (`*-light.webp`,
  `*-dark.webp`). `prefers-reduced-motion` stops the hero video and shows the walkthrough as a still.
- Generic product, no company names; screenshots show made-up demo data only.
- Weight: first screen (HTML, font, poster, hero video) stays under ~3 MB; everything below the hero is
  `loading="lazy"`.
- Relative links only (`app/`, `assets/…`), so the site also works below another path or domain.
  Absolute URLs only where they must be (canonical, `og:image`).

## Assets

- `assets/hero.mp4` / `hero.webm` / `hero-poster.*`: the concept clip, rendered with the motion-broll
  engine (clip source and storyboard are kept outside the repo; re-render there and replace the files).
- `assets/shots/`: desktop screenshots of the web UI (Playwright with mocked `/api`, 1440×900) and the
  app's store screenshots (`store/` on the app branch), as WebP.
- `assets/og.png`: social preview, 1200×630.
