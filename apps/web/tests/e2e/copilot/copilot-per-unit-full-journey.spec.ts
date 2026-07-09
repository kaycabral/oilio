import { expect, test } from '../fixtures'
import { assertDefined } from '../helpers/rules'
import {
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedPaidCharge,
  seedSubscription,
  setActiveUnitCookie,
} from '../helpers/session'

test.describe('brief 0045 — Feature-level DoD (Copiloto por unidade)', { tag: '@journey' }, () => {
  test.use({ orgInput: { unitCount: 2 } })

  test('Cenário 1: acompanhamento na unidade ativa (sem agregado)', async ({ org, authedPage }) => {
    const unitA = org.unitIds[0]
    assertDefined(unitA, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})

    const orderA = await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitA,
      customerId,
      attributedUserId: org.uid,
      totalCents: 20000,
    })
    await seedCommission({
      orgId: org.orgId,
      attributedUserId: org.uid,
      amountCents: 5000,
      orderId: orderA,
    })
    const subA1 = await seedSubscription(org.orgId, customerId, { unitId: unitA })
    await seedPaidCharge(org.orgId, {
      unitId: unitA,
      amountCents: 30000,
      paidAt: new Date().toISOString(),
      customerId,
      subscriptionId: subA1,
    })

    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*450,00/,
    )
    await expect(
      authedPage.getByRole('group', {
        name: 'Projeção de fechamento (nesse ritmo)',
        exact: true,
      }),
    ).not.toContainText(/n\/d/)
    await expect(authedPage.getByText(/todas as unidades|consolidado|agregado/i)).toHaveCount(0)
  })

  test('Cenário 2: avulso e recorrente per-unit (B não vaza em A)', async ({ org, authedPage }) => {
    const unitA = org.unitIds[0]
    const unitB = org.unitIds[1]
    assertDefined(unitA, 'expected a 2-unit org')
    assertDefined(unitB, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})
    const paidAt = new Date().toISOString()

    await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitA,
      customerId,
      attributedUserId: org.uid,
      totalCents: 10000,
    })
    const subA2 = await seedSubscription(org.orgId, customerId, { unitId: unitA })
    await seedPaidCharge(org.orgId, {
      unitId: unitA,
      amountCents: 30000,
      paidAt,
      customerId,
      subscriptionId: subA2,
    })
    await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitB,
      customerId,
      attributedUserId: org.uid,
      totalCents: 99900,
    })
    const subB2 = await seedSubscription(org.orgId, customerId, { unitId: unitB })
    await seedPaidCharge(org.orgId, {
      unitId: unitB,
      amountCents: 50000,
      paidAt,
      customerId,
      subscriptionId: subB2,
    })

    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*400,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Realizado', exact: true }),
    ).not.toContainText(/R\$\s*1\.899,00/)
  })

  test('Cenário 3: honestidade da medição parcial (rótulo após comissão)', async ({
    org,
    authedPage,
  }) => {
    const unitA = org.unitIds[0]
    assertDefined(unitA, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})

    const orderA = await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitA,
      customerId,
      attributedUserId: org.uid,
      totalCents: 10000,
    })
    await seedCommission({
      orgId: org.orgId,
      attributedUserId: org.uid,
      amountCents: 3000,
      orderId: orderA,
    })

    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*70,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
    ).toContainText('parcial (após comissão) — falta custo')
  })
})
