#!/usr/bin/env bash
# EAS Build hook (package.json "eas-build-post-install"): builds the iroh library on the build machine,
# before EAS runs prebuild and Gradle / Xcode. The cloud images have the Android NDK and Xcode, but no
# Rust: install rustup with the targets the platform needs, plus cargo-ndk for Android.
set -euo pipefail
cd "$(dirname "$0")/.."
platform="${EAS_BUILD_PLATFORM:-}"
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
if [[ "$platform" == android ]]; then
  rustup target add aarch64-linux-android x86_64-linux-android
  command -v cargo-ndk >/dev/null || cargo install cargo-ndk --locked
  npm run iroh:android
elif [[ "$platform" == ios ]]; then
  rustup target add aarch64-apple-ios aarch64-apple-ios-sim
  npm run iroh:ios
else
  echo "EAS_BUILD_PLATFORM not set: nothing to build" >&2
fi
