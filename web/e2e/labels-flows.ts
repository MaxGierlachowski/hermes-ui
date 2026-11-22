// Labels on cards, shared by labels.spec.ts (phones) and desktop-labels.spec.ts (desktop): manage the set,
// assign/remove per card, filter the board (any of the selected labels), delete a label everywhere.
import { expect, test, type Page } from '@playwright/test'
import { mockLabels, MOUVE, PRIVAT } from './labels-mock'

const TITLE = {
  approval: 'Landingpage-Build reparieren und deployen',
  clarify: 'Release 1.4 vorbereiten',
  waiting: 'Wochenbericht für das Team zusammenfassen',
  doing: 'Inbox nach Partneranfragen durchsuchen',
}
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Nach Label filtern' })
const filterButton = (page: Page, name: string) => toolbar(page).getByRole('button', { name, exact: true })
const chips = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`).first().getByTestId('label-chip')
const isPhone = () => test.info().project.name !== 'desktop'

async function openBoard(page: Page, hash = '#/board') {
  await page.goto(`/${hash}`)
  await page.getByText(TITLE.approval).first().waitFor()
}

async function openCommand(page: Page) {
  if (isPhone()) await page.getByRole('button', { name: 'Suchen' }).click()
  else await page.keyboard.press('Meta+k')
}

export function labelSuite() {
  test('labels are a managed set: create with a color, rename, then the board offers them as filters', async ({ page }) => {
    const { writes } = await mockLabels(page)
    await openBoard(page, '#/board/s-waiting')
    // Without labels nothing changes: no filter bar, no label button on the card.
    await expect(toolbar(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Labels', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Schließen' }).first().click()

    await openCommand(page)
    await page.getByRole('option', { name: 'Labels verwalten …' }).click()
    const dialog = page.getByRole('dialog', { name: 'Labels' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Name des neuen Labels' }).fill('MOUVE')
    await dialog.getByRole('button', { name: 'Farbe', exact: true }).click()
    await page.getByRole('radio', { name: '#a855f7' }).click()
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await dialog.getByRole('textbox', { name: 'Name des neuen Labels' }).fill('Privat')
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dialog.getByTestId('label-row')).toHaveCount(2)
    expect(writes.filter((w) => w.path === '/api/labels')).toEqual([
      { method: 'POST', path: '/api/labels', body: { name: 'MOUVE', color: '#a855f7' } },
      expect.objectContaining({ method: 'POST', path: '/api/labels', body: expect.objectContaining({ name: 'Privat' }) }),
    ])

    const rename = dialog.getByRole('textbox', { name: 'Name von „Privat“' })
    await rename.fill('Personal')
    await rename.press('Enter')
    await expect.poll(() => writes.filter((w) => w.method === 'PATCH').map((w) => w.body)).toEqual([{ name: 'Personal' }])
    await dialog.getByRole('button', { name: 'Farbe von „MOUVE“' }).click()
    await page.getByRole('radio', { name: '#3b82f6' }).click()
    await expect.poll(() => writes.filter((w) => w.method === 'PATCH').map((w) => w.body)).toEqual([{ name: 'Personal' }, { color: '#3b82f6' }])
    await expect(page.getByRole('radio', { name: '#3b82f6' })).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await expect(filterButton(page, 'MOUVE')).toBeVisible()
    await expect(filterButton(page, 'Personal')).toBeVisible()
  })

  test('assign and remove labels on a card from its thread', async ({ page }) => {
    const { writes, state } = await mockLabels(page, { labels: [MOUVE, PRIVAT] })
    await openBoard(page, '#/board/s-waiting')
    await page.getByRole('button', { name: 'Labels', exact: true }).click()
    await page.getByRole('checkbox', { name: 'MOUVE' }).click()
    await expect(page.getByRole('checkbox', { name: 'MOUVE' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('checkbox', { name: 'Privat' }).click()
    await expect.poll(() => writes.filter((w) => w.method === 'PUT').map((w) => w.body)).toEqual([{ labels: ['l-mouve'] }, { labels: ['l-mouve', 'l-privat'] }])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Schließen' }).first().click()
    // The card on the board shows both, and other cards stay unlabeled.
    await expect(chips(page, 's-waiting')).toHaveText(['MOUVE', 'Privat'])
    await expect(chips(page, 's-approval')).toHaveCount(0)

    await openBoard(page, '#/board/s-waiting')
    await page.getByRole('button', { name: 'Labels', exact: true }).click()
    await page.getByRole('checkbox', { name: 'MOUVE' }).click()
    await expect.poll(() => state.cards['s-waiting']).toEqual(['l-privat'])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Schließen' }).first().click()
    await expect(chips(page, 's-waiting')).toHaveText(['Privat'])
  })

  test('filter the board by label: any of the selected labels, kept across a reload', async ({ page }) => {
    await mockLabels(page, { labels: [MOUVE, PRIVAT], cards: { 's-approval': ['l-mouve'], 's-doing': ['l-mouve'], 's-waiting': ['l-privat'] } })
    await openBoard(page)
    await filterButton(page, 'MOUVE').click()
    await expect(filterButton(page, 'MOUVE')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(TITLE.approval).first()).toBeVisible()
    await expect(page.getByText(TITLE.clarify)).toHaveCount(0)
    await expect(page.getByText(TITLE.waiting)).toHaveCount(0)
    if (isPhone()) {
      await expect(page.getByRole('tab', { name: /^Doing/ })).toHaveText(/Doing\s*1$/)
      await expect(page.getByRole('tab', { name: /^Waiting/ })).toHaveText(/Waiting\s*1$/)
    } else {
      await expect(page.getByText(TITLE.doing).first()).toBeVisible()
    }

    // A second label widens the filter (OR).
    await filterButton(page, 'Privat').click()
    await expect(page.getByText(TITLE.waiting).first()).toBeVisible()
    await expect(page.getByText(TITLE.clarify)).toHaveCount(0)

    await filterButton(page, 'Privat').click()
    await page.reload()
    await page.getByText(TITLE.approval).first().waitFor()
    await expect(filterButton(page, 'MOUVE')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(TITLE.waiting)).toHaveCount(0)

    await toolbar(page).getByRole('button', { name: 'Alle zeigen' }).click()
    await expect(page.getByText(TITLE.clarify).first()).toBeVisible()
    await expect(page.getByText(TITLE.waiting).first()).toBeVisible()
  })

  test('deleting a label removes it from every card and from the filter', async ({ page }) => {
    const { writes } = await mockLabels(page, { labels: [MOUVE, PRIVAT], cards: { 's-approval': ['l-mouve', 'l-privat'], 's-waiting': ['l-mouve'] } })
    await openBoard(page)
    await filterButton(page, 'MOUVE').click()
    await expect(page.getByText(TITLE.clarify)).toHaveCount(0)

    page.on('dialog', (d) => d.accept())
    await toolbar(page).getByRole('button', { name: 'Labels verwalten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Labels' })
    await expect(dialog.getByText('2 Karten')).toBeVisible()
    await dialog.getByRole('button', { name: '„MOUVE“ löschen' }).click()
    await expect(dialog.getByTestId('label-row')).toHaveCount(1)
    expect(writes.filter((w) => w.method === 'DELETE').map((w) => w.path)).toEqual(['/api/labels/l-mouve'])
    await page.keyboard.press('Escape')

    await expect(filterButton(page, 'MOUVE')).toHaveCount(0)
    await expect(filterButton(page, 'Privat')).toBeVisible()
    // The filter on the deleted label is gone with it: the whole board shows again.
    await expect(page.getByText(TITLE.clarify).first()).toBeVisible()
    await expect(chips(page, 's-approval')).toHaveText(['Privat'])
    await expect(chips(page, 's-waiting')).toHaveCount(0)
  })
}
