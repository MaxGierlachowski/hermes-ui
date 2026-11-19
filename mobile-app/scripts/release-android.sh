#!/usr/bin/env bash
# Release build for Android: the iroh library (Rust), a clean prebuild, then the Play bundle (AAB) and
# one APK per ABI for direct installation. Output: dist/hermes-ui-<version>-<build>.aab / -<abi>.apk.
#
# Signing: mobile-app/.secrets/keystore.properties or the file in HERMES_UI_KEYSTORE_PROPERTIES (see
# docs/mobile-app.md). Without one the artifacts are debug-signed: fine to try, not for the store.
# SKIP_IROH=1 reuses the library from the last run.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./version.json').version")
build=$(node -p "require('./version.json').build")
props="${HERMES_UI_KEYSTORE_PROPERTIES:-$PWD/.secrets/keystore.properties}"
[[ -f "$props" ]] && echo "signing with $props" || echo "WARNING: no keystore properties ($props) – debug-signed build" >&2

[[ "${SKIP_IROH:-}" == 1 ]] || npm run iroh:android
npx expo prebuild --platform android --clean --no-install
(cd android && ./gradlew --no-daemon app:bundleRelease app:assembleRelease)

mkdir -p dist
out="dist/hermes-ui-$version-$build"
cp android/app/build/outputs/bundle/release/app-release.aab "$out.aab"
for apk in android/app/build/outputs/apk/release/app-*-release.apk; do
  abi=$(basename "$apk" | sed -E 's/^app-(.*)-release\.apk$/\1/')
  cp "$apk" "$out-$abi.apk"
done
(cd dist && shasum -a 256 "hermes-ui-$version-$build"* | tee "hermes-ui-$version-$build.sha256")
