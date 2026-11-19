# Contributing

Thanks for helping. Hermes UI is a personal open-source project; issues and pull requests are welcome.

- **Setup:** `scripts/bootstrap.sh` (add `--mobile` for the app), see [docs/development.md](docs/development.md).
- **Before a PR:** `npm run verify` and `npm run test:ui` (UI tests; desktop pixel baselines are rendered
  on macOS). For the app: `npm --prefix mobile-app run typecheck`, and try the change in the demo mode.
- **Desktop stays pixel-identical** unless the change is meant for the desktop: touch styles go behind
  `pointer: coarse` (`touch:`) or `max-md:`. Update baselines only on purpose
  (`npx playwright test desktop --update-snapshots` in `web/`) and look at them.
- **Style:** match the surrounding code; English in code, comments and docs; UI texts in German as keys
  with the English translation in `shared/i18n-en.ts`. Conventional commits (`feat(web): …`, `fix(mobile-app): …`).
- **No private data:** fixtures, tests, screenshots and logs use made-up names (`acme-site`, `/home/dev`,
  `example.com`). Never commit `.env`, `data/`, keystores or store keys ([docs/secrets-and-state.md](docs/secrets-and-state.md)).
- **Boundaries of the backend:** it reads Hermes' state read-only, writes nothing under `$HERMES_HOME`,
  never restarts the Hermes gateway and sends no commands to Paseo except a user's permission answer.
  Keep it that way ([docs/architecture.md](docs/architecture.md)).
- **Security issues:** please report privately ([SECURITY.md](SECURITY.md)), not as an issue.

By contributing you agree that your contribution is licensed under the MIT license of this repository.
