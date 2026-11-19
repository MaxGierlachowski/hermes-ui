#!/usr/bin/env bash
# Packs everything that must never be in git but is needed on another machine into ONE encrypted file:
# .env (login token, settings), data/ (iroh identity = the backend's endpoint id, paired devices, VAPID
# keys + push subscriptions, board and inbox state, uploaded media), mobile-app/.secrets/ (release
# keystore + properties, store API keys), mobile-app/.env, and the Firebase service-account file named
# by HERMES_UI_FCM_SERVICE_ACCOUNT. Not included: data/bin (downloaded again), logs, build output.
#
#   scripts/export-secrets.sh [-o <file>] [--root <repo dir>] [--openssl]
#
# Encryption: age with a passphrase (`brew install age`), or `openssl enc` (AES-256-CBC, PBKDF2 with
# 600 000 iterations) if age is missing or --openssl is given. Both ask for the passphrase; for scripts,
# HERMES_UI_BACKUP_PASSPHRASE is used with openssl. Keep the file and the passphrase apart (e.g. the file
# in cloud storage, the passphrase in a password manager). See docs/secrets-and-state.md.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$here" out="" use_openssl=0
while (( $# )); do
  case "$1" in
    -o|--out) out="$2"; shift 2 ;;
    --root) root="$(cd "$2" && pwd)"; shift 2 ;;
    --openssl) use_openssl=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
have() { command -v "$1" >/dev/null 2>&1; }
have age || use_openssl=1
ext=$([[ $use_openssl == 1 ]] && echo enc || echo age)
out="${out:-$HOME/hermes-ui-secrets-$(date +%Y%m%d-%H%M).tar.gz.$ext}"
case "$(cd "$(dirname "$out")" && pwd)/" in
  "$root"/*) [[ "$(basename "$out")" == hermes-ui-secrets-* ]] || { echo "refusing to write a backup inside the repo under another name than hermes-ui-secrets-* (git-ignored)" >&2; exit 1; } ;;
esac

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/hermes-ui"
copy() { # copy <path relative to root>
  [[ -e "$root/$1" ]] || return 0
  mkdir -p "$stage/hermes-ui/$(dirname "$1")"
  cp -pR "$root/$1" "$stage/hermes-ui/$1"
  echo "  + $1"
}
echo "collecting from $root:"
copy .env
if [[ -d "$root/data" ]]; then
  for f in "$root"/data/*; do
    n="$(basename "$f")"
    [[ "$n" == bin || "$n" == *.log ]] && continue
    copy "data/$n"
  done
  find "$stage/hermes-ui/data" -name '*.log' -delete 2>/dev/null || true
fi
copy mobile-app/.secrets
copy mobile-app/.env
# The Firebase service account usually lives outside the repo: stored under external/ with its name.
fcm="${HERMES_UI_FCM_SERVICE_ACCOUNT:-}"
[[ -z "$fcm" && -f "$root/.env" ]] && fcm="$(sed -n 's/^HERMES_UI_FCM_SERVICE_ACCOUNT=//p' "$root/.env" | tail -1 | tr -d '"'"'")"
fcm="${fcm/#\~/$HOME}"
if [[ -n "$fcm" && -f "$fcm" ]]; then
  mkdir -p "$stage/hermes-ui/external"; cp -p "$fcm" "$stage/hermes-ui/external/$(basename "$fcm")"
  echo "$fcm" > "$stage/hermes-ui/external/.fcm-path"; echo "  + external/$(basename "$fcm") (from $fcm)"
fi
[[ -n "$(ls -A "$stage/hermes-ui")" ]] || { echo "nothing to export" >&2; exit 1; }
printf 'hermes-ui secrets backup\ncreated %s\nfrom %s\n' "$(date -u +%FT%TZ)" "$(hostname -s)" > "$stage/hermes-ui/BACKUP-INFO"

umask 077
if [[ $use_openssl == 1 ]]; then
  pass_args=(); [[ -n "${HERMES_UI_BACKUP_PASSPHRASE:-}" ]] && pass_args=(-pass env:HERMES_UI_BACKUP_PASSPHRASE)
  tar -C "$stage" -czf - hermes-ui | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -md sha256 "${pass_args[@]}" -out "$out"
else
  tar -C "$stage" -czf - hermes-ui | age --passphrase --output "$out"
fi
echo "encrypted backup: $out ($(du -h "$out" | cut -f1)); restore with scripts/import-secrets.sh \"$out\""
