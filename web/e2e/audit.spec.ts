import fs from 'node:fs'
import { test } from '@playwright/test'
import { SCREENS } from './screens'
import { measureTargets, smallInputs } from './targets'

// Not a check: `AUDIT_OUT=file.json npx playwright test audit` records the raw measurements behind the
// mobile audit (targets under 44 px, fields under 16 px, text under 11 px, horizontal overflow).
const out = process.env.AUDIT_OUT
for (const screen of SCREENS) {
  test(`audit: ${screen.name}`, async ({ page }, info) => {
    test.skip(!out, 'set AUDIT_OUT to record measurements')
    await screen.setup(page, true)
    const targets = await measureTargets(page, 44)
    const inputs = await smallInputs(page)
    const page2 = await page.evaluate(() => {
      const tiny = new Map<string, number>()
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (!(el as HTMLElement).innerText || el.children.length) continue
        const r = el.getBoundingClientRect()
        if (!r.width || r.bottom < 0 || r.top > innerHeight) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 11) tiny.set(`${fs}px`, (tiny.get(`${fs}px`) || 0) + 1)
      }
      return { tinyText: Object.fromEntries(tiny), overflowX: document.documentElement.scrollWidth - innerWidth }
    })
    fs.appendFileSync(out!, JSON.stringify({ project: info.project.name, screen: screen.name, targets, inputs, ...page2 }) + '\n')
  })
}
