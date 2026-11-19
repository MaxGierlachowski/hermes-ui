# Secrets and state

Everything the repository deliberately does **not** contain, and how to move it to another machine.
Code, docs and configuration templates are all in git; the files below are not, and some of them
cannot be recreated.

## What and why

| Path (repo-relative) | Contains | If lost |
|---|---|---|
| `mobile-app/.secrets/release.keystore` + `keystore.properties` | Android **upload / release key** and its passwords | **Not recreatable.** Installed APKs only update with the same key. On Play (with Play App Signing) the upload key can be reset through Google support, which takes days. |
| `data/iroh/gateway.key` | the backend's iroh secret key = its **endpoint id** | Every device must pair again; pairing links and QR codes change. |
| `data/devices.json` | paired devices (allow-list) and local browser sessions | Every device must pair again. |
| `data/vapid.json`, `data/push.json` | Web Push key pair and push subscriptions | Browsers must enable notifications again. |
| `data/board.json` | manual column choices ("Done"), drafts | Cards fall back to automatic columns. |
| `data/inbox.json` | inbox history (30 days) | History is empty; open requests come back from Hermes. |
| `data/media/` | uploaded images and voice messages | Old messages show placeholders. |
| `.env` | `HERMES_UI_TOKEN` (local login) and your settings | A new token is generated; browsers sign in again. |
| `mobile-app/.env` | app identity (id, name, hosts, team id, EAS id) | Rebuild from `.env.example`; the app id must stay the same. |
| Firebase service account (path in `HERMES_UI_FCM_SERVICE_ACCOUNT`) | lets the backend send FCM push | Generate a new key in Firebase. |
| `mobile-app/.secrets/google-services.json` | Firebase app config for the build | Download again from Firebase. |
| `mobile-app/.secrets/play-service-account.json`, `AuthKey_*.p8` | Play / App Store Connect API access | Create new keys in the consoles. |

Not worth keeping: `data/bin/` (iroh-gateway, downloaded and verified again), logs, `node_modules/`,
`android/`, `ios/`, Rust `target/`, `dist/`.

Never in git: all of the above are in `.gitignore`. Do not paste their contents into issues, logs or
chats; push payloads and logs never contain them.

## Backup and restore

```bash
scripts/export-secrets.sh                     # → ~/hermes-ui-secrets-<date>.tar.gz.age (asks for a passphrase)
scripts/export-secrets.sh -o /Volumes/USB/hermes-ui-secrets.tar.gz.age
scripts/import-secrets.sh ~/hermes-ui-secrets-<date>.tar.gz.age --list     # show contents
scripts/import-secrets.sh ~/hermes-ui-secrets-<date>.tar.gz.age            # restore (keeps existing files)
scripts/import-secrets.sh <file> --force                                    # replace, old files → *.bak
```

- Encryption: [age](https://age-encryption.org) with a passphrase (`brew install age`); without age,
  `openssl enc` (AES-256-CBC, PBKDF2-SHA256, 600 000 iterations, file ending `.enc`). Both ask for the
  passphrase interactively; `HERMES_UI_BACKUP_PASSPHRASE` works for openssl in scripts.
- The archive is written **outside the repo** by default. Inside the repo only under the git-ignored
  name `hermes-ui-secrets-*`.
- Import rewrites `storeFile` in `keystore.properties` to the new checkout and puts the Firebase
  service account back to its old path (or next to the repo, updating `.env`).
- Stop the backend before restoring `data/` (`launchctl unload …` for a LaunchAgent): it rewrites its
  files while it runs.

**Where to keep it:** the archive in two places (e.g. cloud storage and a USB stick), the passphrase in
a password manager, not next to the archive. Alternatively store the keystore and `keystore.properties`
directly as attachments in the password manager. Make a new backup after pairing new devices or
creating store keys.

## Moving to a new Mac

1. `git clone https://github.com/MaxGierlachowski/hermes-ui.git && cd hermes-ui`
2. Copy the backup over, then `scripts/import-secrets.sh <backup>`.
3. `scripts/bootstrap.sh --mobile` ([development.md](development.md)).
4. Start the backend (`npm start`, or a LaunchAgent: `node server/scripts/launchd-plist.mjs --remote iroh`).
   Paired phones reconnect by themselves: same endpoint id, same allow-list.
5. If `HERMES_HOME` or other paths in `.env` pointed at the old machine's home directory, check them.

## What lives where (overview)

| Where | What |
|---|---|
| GitHub repo `MaxGierlachowski/hermes-ui` | all code, docs, store texts and graphics, CI |
| GitHub Releases | `mobile-app-v*` pre-releases with signed APKs / AAB and SHA-256 lists |
| GitHub Pages | the static web UI plus `privacy/` and `support/` (built from `main`) |
| Your encrypted backup | everything in the table above |
| Store consoles (later) | listings, screenshots, Play App Signing key (held by Google) |
