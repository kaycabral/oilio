import { expect, test } from './fixtures'

test.describe('Copiloto — meta de lucro (CRUD)', () => {
  test.use({ orgInput: { unitCount: 1 } })

  test('empty-state → define → edita pelo fluxo real', async ({ authedPage }) => {
    await authedPage.goto('/copilot')
    await expect(authedPage).toHaveURL(/\/copilot$/)

    await expect(
      authedPage.getByRole('heading', { name: 'Defina sua meta de lucro' }),
    ).toBeVisible()
    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toHaveCount(0)

    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toContainText(/R\$\s*5\.000,00/)

    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('7500')
    await authedPage.getByRole('button', { name: 'Salvar meta' }).click()
    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toContainText(/R\$\s*7\.500,00/)
  })
})
