#!/usr/bin/env bash
# Builds the Rust library for iOS (device + Apple-silicon simulator) as HermesIrohFFI.xcframework and
# generates the Swift bindings (UniFFI). Output (git-ignored): ios/HermesIrohFFI.xcframework, ios/Generated/.
#
# Needs: Xcode, rustup targets aarch64-apple-ios aarch64-apple-ios-sim.
set -euo pipefail
cd "$(dirname "$0")/.."
MOD="$PWD"
cd rust

export IPHONEOS_DEPLOYMENT_TARGET=16.4
# Current libc hides net/route.h for iOS, which iroh's netwatch needs: build against a patched copy
# (scripts/ios-patches.py). Cargo.lock is restored afterwards, so the repo stays as it is.
libc_dir="$(python3 "$MOD/scripts/ios-patches.py")"
cp Cargo.lock target/Cargo.lock.before-ios
trap 'cp target/Cargo.lock.before-ios Cargo.lock' EXIT
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo build --release --lib --target "$target" --target-dir target/ios --config "patch.crates-io.libc.path='$libc_dir'"
done

# Bindings from the host build's metadata (library mode), same as for Android.
cargo build --release --lib --target-dir target/host
host_lib=target/host/release/libhermes_iroh.dylib
gen="$MOD/ios/Generated"
rm -rf "$gen" && mkdir -p "$gen/headers"
cargo run --quiet --release --features bindgen --bin uniffi-bindgen --target-dir target/host -- \
  generate --library "$host_lib" --language swift --out-dir "$gen"
# The C header + module map go into the XCFramework; the Swift file is compiled by the pod.
mv "$gen/hermes_irohFFI.h" "$gen/headers/"
mv "$gen/hermes_irohFFI.modulemap" "$gen/headers/module.modulemap"

rm -rf "$MOD/ios/HermesIrohFFI.xcframework"
xcodebuild -create-xcframework \
  -library target/ios/aarch64-apple-ios/release/libhermes_iroh.a -headers "$gen/headers" \
  -library target/ios/aarch64-apple-ios-sim/release/libhermes_iroh.a -headers "$gen/headers" \
  -output "$MOD/ios/HermesIrohFFI.xcframework"
echo "ios: $(du -sh "$MOD/ios/HermesIrohFFI.xcframework" | cut -f1) xcframework"
