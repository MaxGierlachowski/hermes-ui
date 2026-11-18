import { expect, test } from '@playwright/test'
import { SCREENS } from './screens'

// The mobile work must leave the desktop pixel-identical: these baselines were recorded from `main`
// before the mobile changes (1440 × 900, mouse, light and dark) and must keep matching exactly.
for (const theme of ['light', 'dark'] as const) {
  for (const screen of SCREENS.filter((s) => !s.mobileOnly)) {
    test(`desktop unchanged: ${screen.name} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('hk_theme_v2', t), theme)
      await screen.setup(page, false)
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`)
    })
  }
}
