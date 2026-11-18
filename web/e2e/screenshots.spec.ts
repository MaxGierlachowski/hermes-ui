import { test } from '@playwright/test'
import { SCREENS } from './screens'

// Not a check: `SHOTS_DIR=… npx playwright test screenshots` writes one PNG per screen, phone and theme
// (used for before/after comparisons in reviews). Skipped without SHOTS_DIR.
const dir = process.env.SHOTS_DIR
for (const theme of ['light', 'dark'] as const) {
  for (const screen of SCREENS) {
    test(`screenshot: ${screen.name} (${theme})`, async ({ page }, info) => {
      test.skip(!dir, 'set SHOTS_DIR to write screenshots')
      await page.addInitScript((t) => localStorage.setItem('hk_theme_v2', t), theme)
      await screen.setup(page, true)
      await page.screenshot({ path: `${dir}/${info.project.name}/${screen.name}-${theme}.png`, animations: 'disabled' })
    })
  }
}
