import { expect, test } from '@playwright/test'
import { SCREENS } from './screens'
import { measureTargets, smallInputs } from './targets'

// Apple HIG: 44 × 44 pt; Material: 48 × 48 dp. Every interactive element on every phone screen must be
// hittable over at least 44 × 44 CSS px, and no field may be below 16 px (iOS Safari zooms into it).
// Geometry does not depend on the theme, so one theme is enough here.
for (const screen of SCREENS) {
  test(`touch targets ≥ 44 px: ${screen.name}`, async ({ page }) => {
    await screen.setup(page, true)
    const misses = await measureTargets(page, 44)
    expect(misses, JSON.stringify(misses, null, 1)).toEqual([])
    expect(await smallInputs(page)).toEqual([])
  })
}
