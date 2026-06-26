import { expect, test } from './fixtures'

// Brief 0042 (#1114) — Copiloto, Cenário 1 (define meta e acompanha) na parte
// CRUD: render + empty-state, define pelo fluxo real da UI → a meta aparece,
// editar → reflete. Exercita o fluxo de verdade (form real, server action,
// emitEvent → projeção), não um seed idealizado.
test.describe('Copiloto — meta de lucro (CRUD)', () => {
  test.use({ orgInput: { unitCount: 1 } })

  test('empty-state → define → edita pelo fluxo real', async ({ authedPage }) => {
    await authedPage.goto('/copilot')
    await expect(authedPage).toHaveURL(/\/copilot$/)

    // Empty-state: sem meta definida, CTA para definir (nenhuma sugestão chutada).
    await expect(
      authedPage.getByRole('heading', { name: 'Defina sua meta de lucro' }),
    ).toBeVisible()
    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toHaveCount(0)

    // Define a meta pelo formulário real.
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    // A meta aparece no acompanhamento.
    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toContainText(/R\$\s*5\.000,00/)

    // Editar o valor reflete imediatamente.
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('7500')
    await authedPage.getByRole('button', { name: 'Salvar meta' }).click()
    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toContainText(/R\$\s*7\.500,00/)
  })
})
