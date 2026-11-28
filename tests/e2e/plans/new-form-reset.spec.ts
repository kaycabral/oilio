import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'

test.describe('Plans — preserved page state (#71)', () => {
  test('voltar para "Novo plano" depois de criar abre o formulário vazio, sem IDs repetidos na edição', async ({
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Plano Reset ${ts}`

    await authedPage.goto('/plans/new')
    await authedPage.getByRole('textbox', { name: 'Nome' }).fill(name)
    await authedPage.locator('input[name="priceCents"]').filter({ visible: true }).fill('49,90')
    await authedPage.locator('input[name="limitQuantity"]').filter({ visible: true }).fill('2')
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/plans\/.+/)
    await expect(authedPage.getByRole('textbox', { name: 'Nome' })).toHaveValue(name)
    const duplicated = await authedPage.evaluate(() => {
      const seen = new Map<string, number>()
      for (const el of document.querySelectorAll('form [id]')) {
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
      }
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
    })
    expect(duplicated).toEqual([])

    await authedPage.goBack()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await authedPage.getByRole('link', { name: 'Novo plano' }).click()
    await expect(authedPage).toHaveURL(/\/plans\/new$/)
    await expect(authedPage.getByRole('textbox', { name: 'Nome' })).toHaveValue('')
  })
})
