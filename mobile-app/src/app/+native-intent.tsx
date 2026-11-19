// Incoming URLs before Expo Router sees them:
//   https://<ui host>/…/#iroh=…&relay=…&pair=…  (pairing link as a web URL) → /pair?link=…
//   hermesui://pair?iroh=…                      → handled by the /pair route itself
//   expo-share-intent's hermesui://dataUrl=…    → / (the root layout reads the share intent)
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/[#?&]iroh=[0-9a-f]{64}/i.test(path) && !/^hermesui:\/\/pair/i.test(path)) return `/pair?link=${encodeURIComponent(path)}`
    if (/dataUrl=/.test(path)) return '/'
    return path
  } catch {
    return '/'
  }
}
