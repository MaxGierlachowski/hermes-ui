#!/usr/bin/env bash
# One command from a fresh clone to a working setup (macOS; Linux for backend + web).
#
#   scripts/bootstrap.sh              backend + web: Node, npm ci, iroh-gateway, checks, tests, build
#   scripts/bootstrap.sh --mobile     + the app's toolchain (JDK 17, Android SDK/NDK, Rust, cargo-ndk,
#                                       Xcode/CocoaPods on macOS) and the iroh library for Android/iOS
#   scripts/bootstrap.sh --start      afterwards start backend, web dev server and the app's dev server
#   --yes                             install missing tools with Homebrew / sdkmanager / rustup without asking
#   --no-tests                        skip checks, tests and the web build
#
# Versions come from .nvmrc, mise.toml, mobile-app/modules/expo-iroh/rust/rust-toolchain.toml and the
# constants below; docs/development.md lists them. Nothing here touches secrets or data/: restore those
# with scripts/import-secrets.sh (docs/secrets-and-state.md).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

MOBILE=0 START=0 YES=0 TESTS=1
for a in "$@"; do
  case "$a" in
    --mobile) MOBILE=1 ;;
    --start) START=1 ;;
    --yes|-y) YES=1 ;;
    --no-tests) TESTS=0 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

ANDROID_PLATFORM="platforms;android-37.0"   # compileSdk of Expo SDK 58 (targetSdk stays 36)
ANDROID_BUILD_TOOLS="build-tools;37.0.0"
ANDROID_NDK_RN="ndk;27.1.12297006"      # React Native's NDK (react-native/gradle/libs.versions.toml)
ANDROID_NDK_RUST="ndk;28.2.13676358"    # the iroh library (16 KB page alignment by default)
CARGO_NDK_VERSION="4.1.2"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*" >&2; }
die() { printf '   \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
ask() { [[ $YES == 1 ]] && return 0; [[ -t 0 ]] || return 1; read -r -p "   $1 [y/N] " r; [[ $r == [yY]* ]]; }
brew_install() { # brew_install <formula|--cask cask>
  have brew || die "Homebrew missing (https://brew.sh), or install $* yourself"
  ask "install $* with Homebrew?" || die "$* is required"
  brew install "$@"
}

# ---------- Node ----------
step "Node $(cat .nvmrc)"
want_node="$(cat .nvmrc)"
if [[ "$(node -v 2>/dev/null || true)" != "v$want_node" ]]; then
  if have mise; then mise install node && eval "$(mise env -s bash)"
  elif [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    set +u; source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"; nvm install "$want_node" >/dev/null; nvm use "$want_node" >/dev/null; set -u
  elif have fnm; then fnm install "$want_node" && eval "$(fnm env)" && fnm use "$want_node"
  fi
fi
node_v="$(node -v 2>/dev/null || true)"
[[ -n "$node_v" ]] || die "Node.js missing: install mise, nvm or fnm, or Node $want_node from nodejs.org"
major="${node_v#v}"; major="${major%%.*}"
(( major >= 24 )) || die "Node $node_v is too old (need ≥ 24, pinned $want_node)"
[[ "$node_v" == "v$want_node" ]] && ok "node $node_v" || warn "node $node_v (pinned v$want_node; works, but CI uses the pin)"

# ---------- backend + web ----------
step "npm ci (server, web, shared)"
npm ci --no-audit --no-fund
ok "dependencies installed"

step "iroh-gateway"
if node bin/hermes-ui.mjs install-gateway; then ok "iroh-gateway ready (verified SHA-256)"
else warn "could not download iroh-gateway now; the backend retries on its first start with --remote iroh"; fi

if [[ $TESTS == 1 ]]; then
  step "checks, tests, web build"
  npm run check
  npm test
  npm run build
  ok "backend tests green, web/dist built"
fi

# ---------- mobile app ----------
if [[ $MOBILE == 1 ]]; then
  step "mobile app: npm ci"
  npm ci --prefix mobile-app --no-audit --no-fund
  ok "mobile-app dependencies installed"

  step "JDK 17"
  if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME:-}/bin/java" ]]; then
    JAVA_HOME="$( (/usr/libexec/java_home -v 17 2>/dev/null) || ls -d "$HOME"/Library/Java/JavaVirtualMachines/*17*/Contents/Home 2>/dev/null | head -1 || true)"
  fi
  if [[ -z "$JAVA_HOME" || ! -x "$JAVA_HOME/bin/java" ]]; then
    brew_install --cask temurin@17
    JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  fi
  export JAVA_HOME
  ok "$("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"

  step "Android SDK + NDK"
  export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  missing=()
  for p in "$ANDROID_PLATFORM" "$ANDROID_BUILD_TOOLS" "$ANDROID_NDK_RN" "$ANDROID_NDK_RUST" "platform-tools"; do
    [[ -d "$ANDROID_HOME/${p//;//}" ]] || missing+=("$p")
  done
  if (( ${#missing[@]} )); then
    # sdkmanager only when something is missing (Android Studio installs it as "Command-line Tools").
    sdkmanager="$(ls "$ANDROID_HOME"/cmdline-tools/latest/bin/sdkmanager 2>/dev/null || command -v sdkmanager || true)"
    if [[ -z "$sdkmanager" ]]; then
      brew_install --cask android-commandlinetools
      sdkmanager="$(command -v sdkmanager)"
    fi
    ask "install ${missing[*]} with sdkmanager?" || die "Android SDK packages missing: ${missing[*]}"
    yes | "$sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
    "$sdkmanager" --sdk_root="$ANDROID_HOME" "${missing[@]}"
  fi
  export ANDROID_NDK_HOME="$ANDROID_HOME/${ANDROID_NDK_RUST//;//}"
  ok "SDK $ANDROID_HOME, NDK for Rust ${ANDROID_NDK_RUST#ndk;}"

  step "Rust"
  if ! have rustup && [[ -x "${CARGO_HOME:-$HOME/.cargo}/bin/rustup" ]]; then export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"; fi
  if ! have rustup; then
    if have brew && ask "install rustup with Homebrew?"; then brew install rustup && rustup-init -y --no-modify-path
    elif ask "install rustup (https://sh.rustup.rs)?"; then curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    else die "rustup is required for the iroh library"; fi
    export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
  fi
  # rustup puts its own cargo first; Homebrew's cargo has no Android/iOS targets.
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
  (cd mobile-app/modules/expo-iroh/rust && rustup show active-toolchain >/dev/null && rustc --version)
  if [[ "$(cargo ndk --version 2>/dev/null || true)" != *"$CARGO_NDK_VERSION"* ]]; then
    cargo install cargo-ndk --locked --version "$CARGO_NDK_VERSION"
  fi
  ok "toolchain from rust-toolchain.toml, cargo-ndk $CARGO_NDK_VERSION"

  step "iroh library for Android"
  npm --prefix mobile-app run iroh:android
  ok "libhermes_iroh.so + Kotlin bindings"

  if [[ "$(uname)" == Darwin ]]; then
    step "iOS (Xcode, CocoaPods)"
    if have xcodebuild && xcodebuild -version >/dev/null 2>&1; then
      have pod || brew_install cocoapods
      have watchman || warn "watchman not installed (optional, faster Metro file watching): brew install watchman"
      npm --prefix mobile-app run iroh:ios
      ok "HermesIrohFFI.xcframework + Swift bindings ($(xcodebuild -version | head -1))"
    else
      warn "Xcode not installed: skipping iOS (install it from the App Store, then run this again)"
    fi
  fi
fi

step "done"
cat <<EOF
   Backend:   npm start            (http://127.0.0.1:\${HERMES_UI_PORT:-8787}; token is written to .env)
   Web dev:   npm run dev          (Vite on :5173, proxies /api to the backend)
   App:       cd mobile-app && npx expo run:android | npx expo run:ios   (dev client), then npm start
   Release:   npm run app:release:android   (docs/releasing.md)
   Secrets:   scripts/import-secrets.sh <backup.age>   (docs/secrets-and-state.md)
EOF

if [[ $START == 1 ]]; then
  step "starting backend, web dev server and the app's dev server (Ctrl-C stops all)"
  pids=()
  trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
  node bin/hermes-ui.mjs serve & pids+=($!)
  npm run dev & pids+=($!)
  if [[ $MOBILE == 1 || -d mobile-app/node_modules ]]; then (cd mobile-app && npx expo start --dev-client) & pids+=($!); fi
  wait
fi
