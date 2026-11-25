// Automations in the inbox (demo data, app/src/lib/demo.ts): cron runs, webhook runs and notify
// messages folded into one row per job / route / group, the source filter, an entry's report as
// Markdown, its chat, and the inbox opened at one entry (`#/inbox/item/<id>`, here /demo?item=…).
// With SHOTS_DIR set it also writes screenshots (desktop 1440×900, phone 390×844) to
// $SHOTS_DIR/<project>/inbox-automations-*.png.
import { expect, test, type Page } from '@playwright/test'

const groups = (page: Page) => page.getByTestId('automation-group')
const group = (page: Page, name: string) => groups(page).filter({ hasText: name })

async function openInbox(page: Page, query = 'tab=inbox') {
  await page.goto(`/demo?${query}`)
  await expect(group(page, 'daily-report')).toBeVisible()
}

async function shot(page: Page, project: string, name: string) {
  const dir = process.env.SHOTS_DIR
  if (!dir) return
  await page.mouse.move(0, 0) // no hover tint
  await page.waitForTimeout(300) // the chevron and the scroll settle
  await page.screenshot({ path: `${dir}/${project}/inbox-automations-${name}.png` }) // creates the folders
}

test('automation entries are folded into one row per job, route and notify group', async ({ page }) => {
  await openInbox(page)
  await expect(groups(page)).toHaveCount(5)
  for (const name of ['daily-report', 'disk-alert', 'backup-check', 'ci-pipeline', 'deploy']) await expect(group(page, name)).toHaveCount(1)
  // Source, entries, unread counter of the newest group rows.
  await expect(group(page, 'daily-report')).toContainText('Cron')
  await expect(group(page, 'daily-report')).toContainText('3 Einträge')
  await expect(group(page, 'ci-pipeline')).toContainText('Webhook')
  await expect(group(page, 'deploy')).toContainText('Notify')
  await expect(group(page, 'disk-alert')).toContainText('Fehler')
  // Chat entries stay single rows next to them.
  await expect(page.getByText('Wochenbericht für das Team zusammenfassen').filter({ visible: true }).first()).toBeVisible()
})

test('the source filter shows chats, agents or automations; the kind filter narrows the groups', async ({ page }) => {
  await openInbox(page)
  await page.getByRole('tab', { name: 'Automationen' }).click()
  await expect(groups(page)).toHaveCount(5)
  await expect(page.getByText('Bericht steht im Thread.')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Fehler' }).click()
  // disk-alert, backup-check and the failed deploy; daily-report and ci-pipeline only reported.
  await expect(groups(page)).toHaveCount(3)
  await expect(group(page, 'daily-report')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Alle', exact: true }).click()
  await page.getByRole('tab', { name: 'Chats' }).click()
  await expect(groups(page)).toHaveCount(0)
  await expect(page.getByText('Bericht steht im Thread.')).toBeVisible()
})

test('a group expands into its runs; a run shows its report as Markdown and opens its chat', async ({ page }) => {
  await openInbox(page)
  await group(page, 'daily-report').click()
  const runs = page.getByTestId('automation-entry')
  await expect(runs).toHaveCount(3)
  await runs.first().click()
  const body = page.getByTestId('automation-body')
  await expect(body).toBeVisible()
  await expect(body.getByText('Tagesbericht, heute')).toBeVisible() // ## heading
  await expect(body.getByText('3 neue Issues')).toBeVisible() // **bold**
  await expect(body.getByText('Verfügbarkeit')).toBeVisible() // table
  await body.getByText('Zum Chat').click()
  // The cron job's chat, with a composer to write on in it.
  await expect(page.getByText('Tägliche Zusammenfassung').filter({ visible: true }).first()).toBeVisible()
  await expect(page.locator('textarea').last()).toBeEditable()
})

test('a script run without a chat: no jump, the folded repeats are shown', async ({ page }) => {
  await openInbox(page)
  await group(page, 'disk-alert').click()
  await page.getByTestId('automation-entry').first().click()
  const body = page.getByTestId('automation-body')
  await expect(body.getByText('check-disk.sh', { exact: false }).first()).toBeVisible()
  await expect(page.getByTestId('automation-entry').first()).toContainText('×3')
  await expect(body.getByText('Zum Chat')).toHaveCount(0)
})

test('#/inbox/item/<id>: the inbox opens at that entry, expanded', async ({ page }) => {
  await page.goto(`/demo?item=${encodeURIComponent('notify:3f6c1e2a-demo-deploy-2')}`)
  const body = page.getByTestId('automation-body')
  await expect(body).toBeVisible()
  await expect(body.getByText('Zurückgerollt auf', { exact: false })).toBeVisible()
  await expect(body.getByText('example.com/deploys/1042')).toBeVisible()
})

test('screenshots (SHOTS_DIR)', async ({ page, browser }, info) => {
  test.skip(!process.env.SHOTS_DIR, 'only with SHOTS_DIR')
  const project = info.project.name
  await openInbox(page)
  // The history starts below "Needs you": the Automationen filter brings the groups to the top.
  await page.getByRole('tab', { name: 'Automationen' }).click()
  await shot(page, project, 'desktop')
  await group(page, 'daily-report').click()
  await page.getByTestId('automation-entry').first().click()
  await expect(page.getByTestId('automation-body')).toBeVisible()
  await shot(page, project, 'desktop-expanded')

  // A phone: touch input, 390 × 844.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin' })
  const phone = await ctx.newPage()
  await phone.goto(`${info.project.use.baseURL}/demo?tab=inbox`)
  await expect(group(phone, 'daily-report')).toBeVisible()
  await phone.getByRole('tab', { name: 'Automationen' }).tap()
  await shot(phone, project, 'phone')
  await group(phone, 'disk-alert').tap()
  await phone.getByTestId('automation-entry').first().tap()
  await expect(phone.getByTestId('automation-body')).toBeVisible()
  await shot(phone, project, 'phone-expanded')
  await ctx.close()
})
