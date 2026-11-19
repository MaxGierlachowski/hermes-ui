# Hermes UI – mobile app (Android / iOS)

A React Native app (Expo SDK 58) for the hermes-ui backend, with native screens and a native iroh client
(`modules/expo-iroh`, Rust through UniFFI). The manual is **[docs/app.md](../docs/app.md)**;
store releases: [docs/releasing.md](../docs/releasing.md).

```bash
npm ci
npm run release:android        # AAB + APKs in dist/ (toolchain: ../scripts/bootstrap.sh --mobile)
npx expo run:android           # dev build on a device / emulator
npx expo run:ios               # simulator
npm run typecheck
```

| Path | What |
|---|---|
| `src/app/` | screens (Expo Router) |
| `src/components/`, `src/lib/` | UI components; store, connection, cache, notifications, demo mode |
| `modules/expo-iroh/` | native iroh client: Rust crate + Kotlin/Swift module + build scripts |
| `plugins/` | config plugins: release signing + ABIs, foreground-service type |
| `scripts/` | release build, EAS build hook |
| `app.config.ts`, `.env.example`, `version.json`, `eas.json` | identity, store settings, version, EAS profiles |
