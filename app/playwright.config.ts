import { defineConfig, devices } from '@playwright/test'

// UI tests of the app's web build (`npm run web:export` first), in the engines behind its targets:
// WebKit (desktop app on macOS, Safari, iOS) and Chromium (Chrome, Android, the desktop app on Windows).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4180', locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  webServer: { command: 'node e2e/serve.mjs 4180', url: 'http://127.0.0.1:4180', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  ],
})
