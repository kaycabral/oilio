import { expect, test } from './fixtures'
import { assertDefined } from './helpers/rules'
import {
  seedCustomer,
  seedPaidCharge,
  seedSubscription,
  setActiveUnitCookie,
} from './helpers/session'

test.describe('Copiloto — acompanhamento & projeção', () => {
  test.use({ orgInput: { unitCount: 1 } })

  test('meta sem vendas: realizado 0, projeção n/d, rótulo honesto', async ({ authedPage }) => {
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toContainText(/R\$\s*5\.000,00/)
    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*0,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Projeção de fechamento (nesse ritmo)', exact: true }),
    ).toContainText(/n\/d — sem vendas ainda/)
    await expect(
      authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
    ).toContainText('só receita — falta todo o custo')
  })

  test('receita recorrente entra no realizado; MRR fica à parte', async ({ authedPage, org }) => {
    const unitId = org.unitIds[0]
    assertDefined(unitId, 'expected a 1-unit org')
    const customerId = await seedCustomer(org.orgId, {})
    await seedSubscription(org.orgId, customerId, {
      unitId,
      priceCents: 9000,
      status: 'active',
    })
    await seedPaidCharge(org.orgId, {
      unitId,
      amountCents: 30000,
      paidAt: new Date().toISOString(),
      customerId,
    })

    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*300,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Projeção de fechamento (nesse ritmo)', exact: true }),
    ).not.toContainText(/n\/d/)
    await expect(
      authedPage.getByRole('group', { name: 'MRR (observação — fora do realizado)', exact: true }),
    ).toContainText(/R\$\s*90,00/)
  })
})

test.describe('Copiloto — isolamento por unidade (Cenário 2)', () => {
  test.use({ orgInput: { unitCount: 2 } })

  test('recorrente de outra unidade NÃO entra no realizado da unidade ativa', async ({
    authedPage,
    org,
  }) => {
    const activeUnitId = org.unitIds[0]
    const otherUnitId = org.unitIds[1]
    assertDefined(activeUnitId, 'expected a 2-unit org')
    assertDefined(otherUnitId, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})
    const paidAt = new Date().toISOString()

    const subA = await seedSubscription(org.orgId, customerId, { unitId: activeUnitId })
    const subB = await seedSubscription(org.orgId, customerId, { unitId: otherUnitId })

    await seedPaidCharge(org.orgId, {
      unitId: activeUnitId,
      amountCents: 30000,
      paidAt,
      customerId,
      subscriptionId: subA,
    })
    await seedPaidCharge(org.orgId, {
      unitId: otherUnitId,
      amountCents: 50000,
      paidAt,
      customerId,
      subscriptionId: subB,
    })

    await setActiveUnitCookie(authedPage.context(), activeUnitId)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*300,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Realizado', exact: true }),
    ).not.toContainText(/R\$\s*800,00/)
  })
})
