import { expect, test } from '@playwright/test'
import { labelSuite } from './labels-flows'
import { mockLabels, MOUVE, PRIVAT } from './labels-mock'
import { measureTargets, smallInputs } from './targets'

// Phones (iphone-15, iphone-se, pixel-9): filter chips above the column tabs, label picker as a bottom sheet.
labelSuite()

test('touch targets ≥ 44 px: label filter, label picker, label management', async ({ page }) => {
  await mockLabels(page, { labels: [MOUVE, PRIVAT], cards: { 's-approval': ['l-mouve'] } })
  await page.goto('/#/board')
  await page.getByRole('toolbar', { name: 'Nach Label filtern' }).getByRole('button', { name: 'MOUVE' }).click()
  const check = async () => {
    expect(await measureTargets(page, 44)).toEqual([])
    expect(await smallInputs(page)).toEqual([])
  }
  await check()
  await page.goto('/#/board/s-approval')
  await page.getByRole('button', { name: 'Labels', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Privat' }).waitFor()
  await page.waitForTimeout(400)
  await check()
  await page.getByRole('button', { name: 'Labels verwalten …' }).click()
  await page.getByRole('dialog', { name: 'Labels' }).getByTestId('label-row').first().waitFor()
  await page.waitForTimeout(400)
  await check()
})
