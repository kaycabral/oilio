import { expect, test } from '../fixtures'
import { assertDefined } from '../helpers/rules'
import { seedRazaoRevenue, setActiveUnitCookie } from '../helpers/session'

function midCurrentMonthIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0)).toISOString()
}

function nextMonthLabel(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

test.describe('Financeiro — captura de custo fixo (brief 0092)', () => {
  test.describe('unidade única', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('render + empty: seção vazia com CTA', async ({ authedPage }) => {
      await authedPage.goto('/finance')
      await expect(authedPage).toHaveURL(/\/finance$/)

      await expect(authedPage.getByRole('heading', { name: 'Financeiro' })).toBeVisible()
      await expect(authedPage.getByText('Custos fixos', { exact: true })).toBeVisible()
      await expect(authedPage.getByText('Nenhum custo fixo')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Adicionar custo fixo' })).toBeVisible()
    })

    test('Cenário 1: cadastra custo fixo e vê o ponto de equilíbrio', async ({
      authedPage,
      org,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      await seedRazaoRevenue(org.orgId, {
        unitId,
        amountCents: 500000,
        periodStartAt: midCurrentMonthIso(),
      })

      await authedPage.goto('/finance')
      await authedPage.getByLabel('Nome').fill('Aluguel')
      await authedPage.getByLabel('Valor mensal (R$)').fill('2000')
      await authedPage.getByRole('button', { name: 'Adicionar custo fixo' }).click()

      await expect(authedPage.getByText('Aluguel')).toBeVisible()
      await expect(authedPage.getByText(/R\$\s*2\.000,00/).first()).toBeVisible()

      const breakEven = authedPage.getByText(/Pra se pagar, venda/)
      await expect(breakEven).toBeVisible()
      await expect(breakEven).toContainText(/R\$\s*2\.000,00/)
    })

    test('degenerado: sem vendas, equilíbrio mostra rótulo honesto', async ({ authedPage }) => {
      await authedPage.goto('/finance')
      await authedPage.getByLabel('Nome').fill('Aluguel')
      await authedPage.getByLabel('Valor mensal (R$)').fill('2000')
      await authedPage.getByRole('button', { name: 'Adicionar custo fixo' }).click()

      await expect(authedPage.getByText('Aluguel')).toBeVisible()
      await expect(authedPage.getByText(/Indisponível/)).toBeVisible()
      await expect(authedPage.getByText(/Pra se pagar, venda/)).toHaveCount(0)
    })

    test('degenerado: valor zero é rejeitado no boundary', async ({ authedPage }) => {
      await authedPage.goto('/finance')
      await authedPage.getByLabel('Nome').fill('Aluguel')
      await authedPage.getByLabel('Valor mensal (R$)').fill('0')
      const submit = authedPage.getByRole('button', { name: 'Adicionar custo fixo' })
      await expect(submit).toBeDisabled()
    })

    test('Cenário 2: editar o valor não retroage (vigência versionada)', async ({
      authedPage,
      org,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      await seedRazaoRevenue(org.orgId, {
        unitId,
        amountCents: 500000,
        periodStartAt: midCurrentMonthIso(),
      })

      await authedPage.goto('/finance')
      await authedPage.getByLabel('Nome').fill('Aluguel')
      await authedPage.getByLabel('Valor mensal (R$)').fill('2000')
      await authedPage.getByRole('button', { name: 'Adicionar custo fixo' }).click()
      await expect(authedPage.getByText('Aluguel')).toBeVisible()

      const breakEven = authedPage.getByText(/Pra se pagar, venda/)
      await expect(breakEven).toContainText(/R\$\s*2\.000,00/)

      await authedPage.getByRole('button', { name: 'Ações de Aluguel' }).click()
      await authedPage.getByRole('menuitem', { name: 'Editar valor' }).click()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByLabel('Novo valor mensal (R$)').fill('4000')
      await dialog.getByLabel('A partir do mês').fill(nextMonthLabel())
      await dialog.getByRole('button', { name: 'Salvar novo valor' }).click()
      await expect(dialog).toBeHidden()

      await expect(breakEven).toContainText(/R\$\s*2\.000,00/)
      await expect(breakEven).not.toContainText(/R\$\s*4\.000,00/)
    })

    test('Cenário 4: arquivar um custo fixo remove da lista de ativos', async ({ authedPage }) => {
      await authedPage.goto('/finance')
      await authedPage.getByLabel('Nome').fill('Aluguel Loja')
      await authedPage.getByLabel('Valor mensal (R$)').fill('2000')
      await authedPage.getByRole('button', { name: 'Adicionar custo fixo' }).click()

      const item = authedPage.getByRole('listitem').filter({ hasText: 'Aluguel Loja' })
      await expect(item).toBeVisible()

      await authedPage.getByRole('button', { name: 'Ações de Aluguel Loja' }).click()
      await authedPage.getByRole('menuitem', { name: 'Arquivar' }).click()
      const confirm = authedPage.getByRole('alertdialog')
      await confirm.getByRole('button', { name: 'Arquivar' }).click()
      await expect(confirm).toBeHidden()

      await expect(
        authedPage.getByRole('listitem').filter({ hasText: 'Aluguel Loja' }),
      ).toHaveCount(0)
      await expect(authedPage.getByText('Nenhum custo fixo')).toBeVisible()
    })
  })

  test.describe('escopo por unidade', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('Cenário 3: custo de uma unidade não aparece na outra (zero rateio)', async ({
      authedPage,
      org,
    }) => {
      const unitA = org.unitIds[0]
      const unitB = org.unitIds[1]
      assertDefined(unitA, 'expected a 2-unit org')
      assertDefined(unitB, 'expected a 2-unit org')

      await seedRazaoRevenue(org.orgId, {
        unitId: unitB,
        amountCents: 500000,
        periodStartAt: midCurrentMonthIso(),
      })

      await setActiveUnitCookie(authedPage.context(), unitA)
      await authedPage.goto('/finance')
      await authedPage.getByLabel('Nome').fill('Aluguel Centro')
      await authedPage.getByLabel('Valor mensal (R$)').fill('2000')
      await authedPage.getByRole('button', { name: 'Adicionar custo fixo' }).click()
      await expect(authedPage.getByText('Aluguel Centro')).toBeVisible()

      await setActiveUnitCookie(authedPage.context(), unitB)
      await authedPage.goto('/finance')
      await expect(authedPage.getByText('Aluguel Centro')).toHaveCount(0)
      await expect(authedPage.getByText('Nenhum custo fixo')).toBeVisible()

      await authedPage.getByLabel('Nome').fill('Aluguel Bairro')
      await authedPage.getByLabel('Valor mensal (R$)').fill('1000')
      await authedPage.getByRole('button', { name: 'Adicionar custo fixo' }).click()
      await expect(authedPage.getByText('Aluguel Bairro')).toBeVisible()

      const breakEvenB = authedPage.getByText(/Pra se pagar, venda/)
      await expect(breakEvenB).toBeVisible()
      await expect(breakEvenB).toContainText(/R\$\s*1\.000,00/)
      await expect(breakEvenB).not.toContainText(/R\$\s*3\.000,00/)
    })
  })
})
