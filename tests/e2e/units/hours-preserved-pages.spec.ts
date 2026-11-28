import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'

test.describe('Unidade — horários com páginas mantidas (#85)', () => {
  test.use({ orgInput: { unitCount: 2, hasBusinessHours: true } })

  test('clicar no rótulo "Segunda" da unidade B alterna o interruptor visível', async ({
    org,
    authedPage,
  }) => {
    await authedPage.goto('/organizations')
    await expect(authedPage).toHaveURL(/\/select-unit$/)
    await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
    await expect(authedPage).toHaveURL(/\/agenda$/)
    await authedPage.goto('/organizations')
    await rowAction(authedPage, 'Unidade 1', 'Editar')
    await expect(authedPage).toHaveURL(new RegExp(`/units/${org.unitIds[0]}`))
    await expect(authedPage.getByRole('switch', { name: 'Segunda', exact: true })).toBeChecked()

    await authedPage.goBack()
    await expect(authedPage).toHaveURL(/\/organizations/)
    await rowAction(authedPage, 'Unidade 2', 'Editar')
    await expect(authedPage).toHaveURL(new RegExp(`/units/${org.unitIds[1]}`))

    const form = authedPage.locator('form').filter({ visible: true })
    const monday = form.getByRole('switch', { name: 'Segunda', exact: true })
    await expect(monday).toBeChecked()

    await expect(async () => {
      await form
        .locator('label')
        .filter({ hasText: /^Segunda$/ })
        .click()
      await expect(monday).not.toBeChecked({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })

    const duplicated = await authedPage.evaluate(() => {
      const seen = new Map<string, number>()
      for (const el of document.querySelectorAll('form [id]')) {
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
      }
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
    })
    expect(duplicated).toEqual([])
  })
})
