#!/usr/bin/env bash
# Builds libhermes_iroh.so for Android with cargo-ndk and generates the Kotlin bindings (UniFFI).
# Output (both git-ignored, rebuilt from rust/): android/src/main/jniLibs/<abi>/ and android/src/main/java/uniffi/.
#
# Needs: rustup targets (aarch64-linux-android x86_64-linux-android armv7-linux-androideabi),
# cargo-ndk, and an NDK (ANDROID_NDK_HOME, or the newest one under $ANDROID_HOME/ndk).
# ABIS="arm64-v8a" limits the build. Default: the app's ABIs (app.config.ts, HERMES_UI_ABIS);
# add armeabi-v7a there and here for old 32-bit phones.
set -euo pipefail
cd "$(dirname "$0")/.."
MOD="$PWD"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  ANDROID_NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)"
fi
export ANDROID_NDK_HOME
[[ -d "$ANDROID_NDK_HOME" ]] || { echo "no Android NDK found (set ANDROID_NDK_HOME)" >&2; exit 1; }
ABIS=(${ABIS:-arm64-v8a x86_64})
rm -rf "$MOD/android/src/main/jniLibs"

cd rust
args=()
for abi in "${ABIS[@]}"; do args+=(-t "$abi"); done
# API 24 = the app's minSdk; 16 KB page alignment is the NDK r28 default.
cargo ndk "${args[@]}" -P 24 -o "$MOD/android/src/main/jniLibs" build --release --lib
# cargo-ndk copies every .so of the build (iroh's own cdylib targets too); the app needs only ours.
find "$MOD/android/src/main/jniLibs" -name '*.so' ! -name 'libhermes_iroh.so' -delete

# Bindings come from the compiled library's metadata (library mode), so they always match it.
cargo build --release --lib --target-dir target/host
host_lib=target/host/release/libhermes_iroh.so
[[ -f target/host/release/libhermes_iroh.dylib ]] && host_lib=target/host/release/libhermes_iroh.dylib
rm -rf "$MOD/android/src/main/java/uniffi"
cargo run --quiet --release --features bindgen --bin uniffi-bindgen --target-dir target/host -- \
  generate --library "$host_lib" --language kotlin --out-dir "$MOD/android/src/main/java" --no-format
echo "android: $(du -sh "$MOD/android/src/main/jniLibs" | cut -f1) of native libraries for ${ABIS[*]}"
