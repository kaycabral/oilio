import { expect, test } from '../fixtures'
import { assertDefined } from '../helpers/rules'
import {
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedPaidCharge,
  seedSubscription,
} from '../helpers/session'

test.describe(
  'brief 0042 — Feature-level DoD (Copiloto — meta de lucro + projeção)',
  { tag: '@journey' },
  () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('Cenário 1: definir meta e acompanhar (realizado avulso + recorrente − comissão)', async ({
      org,
      authedPage,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      const customerId = await seedCustomer(org.orgId, {})

      const orderId = await seedClosedOrder({
        orgId: org.orgId,
        unitId,
        customerId,
        attributedUserId: org.uid,
        totalCents: 20000,
      })
      await seedCommission({
        orgId: org.orgId,
        attributedUserId: org.uid,
        amountCents: 5000,
        orderId,
      })
      const subscriptionId = await seedSubscription(org.orgId, customerId, { unitId })
      await seedPaidCharge(org.orgId, {
        unitId,
        amountCents: 30000,
        paidAt: new Date().toISOString(),
        customerId,
        subscriptionId,
      })

      await authedPage.goto('/copilot')
      await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
      await authedPage.getByRole('button', { name: 'Definir meta' }).click()

      await expect(
        authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
      ).toContainText(/R\$\s*5\.000,00/)
      await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
        /R\$\s*450,00/,
      )
      await expect(
        authedPage.getByRole('group', {
          name: 'Projeção de fechamento (nesse ritmo)',
          exact: true,
        }),
      ).not.toContainText(/n\/d/)
    })

    test('Cenário 3: honestidade da medição parcial (rótulo após comissão, sem fingir lucro)', async ({
      org,
      authedPage,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      const customerId = await seedCustomer(org.orgId, {})

      const orderId = await seedClosedOrder({
        orgId: org.orgId,
        unitId,
        customerId,
        attributedUserId: org.uid,
        totalCents: 10000,
      })
      await seedCommission({
        orgId: org.orgId,
        attributedUserId: org.uid,
        amountCents: 3000,
        orderId,
      })

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

    test('Cenário 4: recorrente entra no realizado; MRR fica à parte', async ({
      org,
      authedPage,
    }) => {
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
        authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
      ).toContainText('só receita — falta todo o custo')
      await expect(
        authedPage.getByRole('group', {
          name: 'MRR (observação — fora do realizado)',
          exact: true,
        }),
      ).toContainText(/R\$\s*90,00/)
    })
  },
)
