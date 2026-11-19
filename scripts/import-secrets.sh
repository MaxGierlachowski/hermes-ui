#!/usr/bin/env bash
# Restores a backup made by scripts/export-secrets.sh into this checkout (or --root <dir>).
#
#   scripts/import-secrets.sh <backup.tar.gz.age|.enc> [--root <repo dir>] [--force] [--list]
#
# Existing files are not overwritten unless --force is given; then the old file is kept as <name>.bak.
# keystore.properties gets its storeFile path rewritten to this checkout, and the Firebase service
# account goes back to its old path if that directory exists (else next to the repo, and .env is told).
# Stop a running backend first: it rewrites data/ while it runs.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$here" force=0 list=0 file=""
while (( $# )); do
  case "$1" in
    --root) root="$(cd "$2" && pwd)"; shift 2 ;;
    --force) force=1; shift ;;
    --list) list=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) file="$1"; shift ;;
  esac
done
[[ -f "$file" ]] || { echo "usage: $0 <backup file> [--root <dir>] [--force] [--list]" >&2; exit 2; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
umask 077
if [[ "$file" == *.age ]]; then
  age --decrypt --output "$stage/b.tgz" "$file"
else
  pass_args=(); [[ -n "${HERMES_UI_BACKUP_PASSPHRASE:-}" ]] && pass_args=(-pass env:HERMES_UI_BACKUP_PASSPHRASE)
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 "${pass_args[@]}" -in "$file" -out "$stage/b.tgz"
fi
tar -C "$stage" -xzf "$stage/b.tgz"
src="$stage/hermes-ui"
[[ -f "$src/BACKUP-INFO" ]] || { echo "not a hermes-ui secrets backup" >&2; exit 1; }
sed 's/^/  /' "$src/BACKUP-INFO"
if [[ $list == 1 ]]; then (cd "$src" && find . -type f ! -name BACKUP-INFO | sed 's|^\./|  |' | sort); exit 0; fi

if pgrep -f "hermes-ui.mjs serve" >/dev/null 2>&1 && [[ "$root" == "$here" ]]; then
  echo "  ! a hermes-ui backend is running; it may overwrite data/ again. Stop it first (launchctl unload …)." >&2
fi

restore() { # restore <relative path>
  local rel="$1" dest="$root/$1"
  mkdir -p "$(dirname "$dest")"
  if [[ -e "$dest" ]]; then
    if [[ $force == 0 ]]; then echo "  = $rel exists, kept (use --force to replace)"; return; fi
    rm -rf "$dest.bak"; mv "$dest" "$dest.bak"
  fi
  cp -pR "$src/$rel" "$dest"
  echo "  + $rel"
}
echo "restoring into $root:"
for rel in .env mobile-app/.env mobile-app/.secrets; do [[ -e "$src/$rel" ]] && restore "$rel"; done
if [[ -d "$src/data" ]]; then for f in "$src"/data/*; do restore "data/$(basename "$f")"; done; fi

props="$root/mobile-app/.secrets/keystore.properties"
if [[ -f "$props" ]]; then
  store="$(sed -n 's/^storeFile=//p' "$props")"
  new="$root/mobile-app/.secrets/$(basename "$store")"
  if [[ -n "$store" && "$store" != "$new" && -f "$new" ]]; then
    tmp="$(mktemp)"; sed "s|^storeFile=.*|storeFile=$new|" "$props" > "$tmp" && cat "$tmp" > "$props" && rm "$tmp"
    echo "  ~ keystore.properties: storeFile → $new"
  fi
fi

if [[ -d "$src/external" ]]; then
  for f in "$src"/external/*; do
    old="$(cat "$src/external/.fcm-path" 2>/dev/null || true)"
    if [[ -n "$old" && -d "$(dirname "$old")" && ( ! -e "$old" || $force == 1 ) ]]; then dest="$old"
    else dest="$(dirname "$root")/$(basename "$f")"; fi
    [[ -e "$dest" && $force == 0 ]] && { echo "  = $dest exists, kept"; continue; }
    cp -p "$f" "$dest"; echo "  + $dest (Firebase service account)"
    if [[ -f "$root/.env" && "$dest" != "$old" ]]; then
      tmp="$(mktemp)"; grep -v '^HERMES_UI_FCM_SERVICE_ACCOUNT=' "$root/.env" > "$tmp" || true
      echo "HERMES_UI_FCM_SERVICE_ACCOUNT=$dest" >> "$tmp"; cat "$tmp" > "$root/.env"; rm "$tmp"
      echo "  ~ .env: HERMES_UI_FCM_SERVICE_ACCOUNT → $dest"
    fi
  done
fi
chmod -R go-rwx "$root/mobile-app/.secrets" 2>/dev/null || true
[[ -f "$root/.env" ]] && chmod 600 "$root/.env"
echo "done. Start the backend; paired devices keep working because data/iroh holds the same identity."
