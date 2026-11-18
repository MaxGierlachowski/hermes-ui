import { defineConfig } from '@playwright/test'

// UI tests run against the built bundle (`npm run build` first) served by `vite preview`, with every
// /api request answered from e2e/fixtures.ts. Phones are emulated with touch (pointer: coarse).
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
}
const phone = (width: number, height: number, ua: string, scale = 3) => ({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, userAgent: ua })

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: { baseURL: 'http://127.0.0.1:4179', serviceWorkers: 'block', locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  webServer: { command: 'npx vite preview --port 4179 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4179', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'iphone-15', use: phone(390, 844, UA.iphone), testIgnore: /desktop/ },
    { name: 'iphone-se', use: phone(375, 667, UA.iphone, 2), testIgnore: /desktop/ },
    { name: 'pixel-9', use: phone(412, 915, UA.android, 2.625), testIgnore: /desktop/ },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } }, testMatch: /desktop/ },
  ],
})
