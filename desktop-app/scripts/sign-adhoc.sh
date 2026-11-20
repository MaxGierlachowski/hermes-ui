#!/usr/bin/env bash
# Ad-hoc signature with a stable identity for the unsigned builds, then the DMG.
#
# Why: macOS remembers privacy decisions (microphone, camera, notifications; TCC) per code signature.
# A plain ad-hoc signature is identified by its code hash, which changes with every build, so every
# new build would ask again (or keep a stale "denied"). Here the designated requirement is the bundle
# identifier only, so decisions survive rebuilds. With a Developer ID (docs/releasing.md) the normal
# signing replaces this script.
#
#   scripts/sign-adhoc.sh            after `tauri build --bundles app`
#   HERMES_UI_DESKTOP_IDENTIFIER=…   when the build used another identifier (tauri build --config)
set -euo pipefail
cd "$(dirname "$0")/.."
app="src-tauri/target/release/bundle/macos/Hermes UI.app"
id="${HERMES_UI_DESKTOP_IDENTIFIER:-$(node -p "require('./src-tauri/tauri.conf.json').identifier")}"
version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
ent="src-tauri/Entitlements.plist"
req="designated => identifier \"$id\""
[[ -d "$app" ]] || { echo "no app bundle at $app (run tauri build --bundles app first)" >&2; exit 1; }

# Inside out: the Node sidecar, the main executable, then the bundle (hardened runtime + entitlements).
codesign --force --options runtime --entitlements "$ent" --sign - --identifier "$id.node" "$app/Contents/MacOS/node"
codesign --force --options runtime --entitlements "$ent" --sign - --identifier "$id" -r="$req" "$app/Contents/MacOS/hermes-ui-desktop"
codesign --force --options runtime --entitlements "$ent" --sign - --identifier "$id" -r="$req" "$app"
codesign --verify --strict --verbose=1 "$app"
codesign -d -r- "$app" 2>&1 | grep designated

# DMG: the app and a link to /Applications.
arch="$(uname -m | sed 's/arm64/aarch64/')"
out="src-tauri/target/release/bundle/dmg/Hermes UI_${version}_${arch}.dmg"
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
cp -R "$app" "$stage/" && ln -s /Applications "$stage/Applications"
mkdir -p "$(dirname "$out")" && rm -f "$out"
hdiutil create -quiet -volname "Hermes UI" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$out"
echo "dmg: $out ($(du -h "$out" | cut -f1))"
