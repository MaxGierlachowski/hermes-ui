import { expect, test, type Page } from '@playwright/test'
import { mockApi } from './mock'

// Automation entries in the inbox (cron runs, webhook runs, POST /api/notify): the source filter, one
// collapsible group per job / route / notify group, the report as Markdown, and the push link
// #/inbox/item/<entry>.

async function openInbox(page: Page, hash = '#/inbox') {
  await mockApi(page)
  await page.goto(`/${hash}`)
  await page.getByText('Braucht dich').waitFor()
}

async function pickSource(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Quelle' }).click()
  await page.getByRole('option', { name }).click()
}

const groups = (page: Page) => page.getByTestId('automation-group')

test('the Automationen filter shows only the automation groups', async ({ page }) => {
  await openInbox(page)
  await expect(page.getByText('Wochenbericht für das Team zusammenfassen')).toBeVisible()
  await expect(groups(page)).toHaveCount(4)

  await pickSource(page, 'Automationen')
  await expect(page.getByText('Wochenbericht für das Team zusammenfassen')).toHaveCount(0)
  // Newest first: daily-report (15 min ago), disk-alert, ci-pipeline, deploy.
  await expect(groups(page)).toHaveText([/daily-report.*Cron/, /disk-alert.*Cron/, /ci-pipeline.*Webhook/, /deploy.*Notify/])
  await expect(groups(page).nth(1)).toContainText('Fehler')

  await pickSource(page, 'Chats')
  await expect(groups(page)).toHaveCount(0)
  await expect(page.getByText('Wochenbericht für das Team zusammenfassen')).toBeVisible()

  // The kind filter still applies: errors are the failed run and the chat error.
  await pickSource(page, 'Alle Quellen')
  await page.getByRole('radio', { name: 'Fehler' }).click()
  await expect(groups(page)).toHaveText([/disk-alert/])
  await expect(page.getByText('Rechnungen aus Gmail exportieren')).toBeVisible()
})

test('a group expands into its entries; an entry shows its report as Markdown and marks it read', async ({ page }) => {
  await openInbox(page)
  await pickSource(page, 'Automationen')

  const daily = groups(page).filter({ hasText: 'daily-report' })
  await expect(daily).toContainText('2 Einträge')
  await daily.getByRole('button', { name: /daily-report/ }).click()
  const entries = daily.getByTestId('automation-entry')
  await expect(entries).toHaveCount(2)
  await expect(entries.first()).toContainText('12 neue Chats')
  await expect(entries.last()).toContainText('8 neue Chats')

  // Markdown: a heading, list items and a table, not the raw source.
  await entries.first().getByRole('button', { name: /Tagesbericht erstellt/ }).click()
  const body = entries.first().getByTestId('automation-body')
  await expect(body.getByRole('heading', { name: 'Tagesbericht' })).toBeVisible()
  await expect(body.getByRole('table')).toBeVisible()
  await expect(body).not.toContainText('## Tagesbericht')
  // A run with a chat offers it; a run without one only expands.
  await expect(body.getByRole('button', { name: 'Zum Chat' })).toBeVisible()
  await entries.last().getByRole('button', { name: /Tagesbericht erstellt/ }).click()
  await expect(entries.last().getByTestId('automation-body')).toContainText('keine offenen Freigaben')
  await expect(entries.last().getByRole('button', { name: 'Zum Chat' })).toHaveCount(0)

  // Unread counter on the group, gone once its entry was opened; the repeat count of the folded error.
  const disk = groups(page).filter({ hasText: 'disk-alert' })
  await expect(disk.getByLabel('1 ungelesen')).toBeVisible()
  await disk.getByRole('button', { name: /disk-alert/ }).click()
  await expect(disk.getByTestId('automation-entry')).toContainText('×3')
  await disk.getByTestId('automation-entry').getByRole('button', { name: /Lauf fehlgeschlagen/ }).click()
  await expect(disk.getByText('Filesystem')).toBeVisible()
  await expect(disk.getByLabel('1 ungelesen')).toHaveCount(0)
  await expect(page.getByText(/ungelesen$/)).toHaveText('1 ungelesen')

  // notify: the link the script attached.
  const deploy = groups(page).filter({ hasText: 'deploy' })
  await deploy.getByRole('button', { name: /deploy/ }).click()
  await deploy.getByTestId('automation-entry').getByRole('button', { name: /Deploy auf Staging/ }).click()
  await expect(deploy.getByRole('link', { name: /example\.com\/deploys\/142/ })).toHaveAttribute('href', 'https://example.com/deploys/142')
})

test('#/inbox/item/<entry> (a push) opens that entry expanded and marks it read', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hk_inbox_source', 'chats'))
  await openInbox(page, `#/inbox/item/${encodeURIComponent('cron:disk-alert:1')}`)
  const disk = groups(page).filter({ hasText: 'disk-alert' })
  await expect(disk.getByTestId('automation-body')).toContainText('ist zu 96 % voll')
  await expect(disk.getByTestId('automation-body')).toBeInViewport()
  // The filter that would hide it is reset; the entry is read; the address is the inbox again.
  await expect(page.getByRole('combobox', { name: 'Quelle' })).toHaveText('Alle Quellen')
  await expect(disk.getByLabel('1 ungelesen')).toHaveCount(0)
  await expect(page).toHaveURL(/#\/inbox$/)
})

test('a stored source filter of older builds (hermes | paseo) is migrated', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hk_inbox_source', 'paseo'))
  await openInbox(page)
  await expect(page.getByRole('combobox', { name: 'Quelle' })).toHaveText('Agents')
  await expect(groups(page)).toHaveCount(0)
  await expect(page.getByText('Lighthouse-Check')).toBeVisible()
})

test('"Zum Chat" opens the run\'s chat and the composer sends without asking', async ({ page }) => {
  await openInbox(page)
  page.on('dialog', (d) => { throw new Error(`unexpected dialog: ${d.message()}`) })
  const daily = groups(page).filter({ hasText: 'daily-report' })
  await daily.getByRole('button', { name: /daily-report/ }).click()
  await daily.getByTestId('automation-entry').first().getByRole('button', { name: /Tagesbericht erstellt/ }).click()
  await daily.getByRole('button', { name: 'Zum Chat' }).click()
  await expect(page).toHaveURL(/#\/inbox\/s-done-2$/)
  const composer = page.getByPlaceholder(/Antworten/)
  await composer.fill('Bitte den Bericht morgen um 8 Uhr schicken.')
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/sessions\/s-done-2\/messages$/.test(r.url()))
  await page.getByTestId('send').click()
  expect((await sent).postDataJSON()).toMatchObject({ text: 'Bitte den Bericht morgen um 8 Uhr schicken.' })
})
