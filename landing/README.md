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

## Nothing forwards to /app/ by itself

The landing page never redirects: no script, no meta refresh, no `404.html`, and the root worker
(`sw.js` + `iroh-sw.js`) has no navigation handling (it routes only iroh hosts and opens `/app/` on a
notification click). An earlier version forwarded installed apps, `#/…` routes and pairing links in its
`<head>`; together with Chrome's link capturing of the old install (scope `/hermes-ui/`), that pulled
even plain links to `/` and `/?x` into the app window and on to `/app/`.

Instead, a bar under the skip link offers the way on with one click when the visit looks like it was
meant for the web app:

| Situation | Bar | Button goes to |
|---|---|---|
| pairing link at the root (`#iroh=…&pair=…`, backend `HERMES_UI_URL` without `/app`) | "You opened a pairing link …" | `app/` + the fragment ("Continue pairing in the app") |
| installed app from before the move (`display-mode: standalone` etc., iOS `navigator.standalone`) | "The Hermes UI web app moved to /app/." | `app/` + query |
| this browser holds a pairing (`localStorage.hk_remote`, same origin) | "This browser is paired …" | `app/` ("Open your board") |
| app route from history or a bookmark (`#/board`, `#/inbox/…`) | "Looking for the web app? …" | `app/` + the route |

## Installs from before the move

They have no manifest `id`, so Chrome knows them by their `start_url`, the root. The landing page links
the app's manifest (`<link rel="manifest" href="app/manifest.webmanifest">`), and `build-pages.mjs`
gives that manifest the root as `id` (`PAGES_BASE`, default `/hermes-ui/`). Chrome then treats it as the
same app and, on the next visit to the landing page or launch of the app, moves its `start_url` and
`scope` to `/app/` (Chrome updates both when the `id` matches). From then on the installed app starts in
`/app/` directly and no longer captures links to the landing page. Fresh installs, from the landing page
or `/app/`, get scope `/app/`. iOS keeps the start URL it saved; such installs show the bar.

GitHub Pages caches HTML for up to 10 minutes, so an old copy can show until then.

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
