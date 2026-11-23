import { expect, test } from '../fixtures'
import {
  seedClosedOrder,
  seedCommission as seedCommissionDoc,
  type SeededOrg,
} from '../helpers/session'

type SeedCommission = {
  attributedUserId: string
  itemName: string
  amountCents: number
  liquidationStatus: 'pendente' | 'pago'
}

async function seedCommission(org: SeededOrg, c: SeedCommission): Promise<void> {
  const orderId = await seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: c.amountCents * 2,
  })
  await seedCommissionDoc({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: c.amountCents,
    liquidationStatus: c.liquidationStatus,
    orderId,
    itemName: c.itemName,
  })
}

test.describe('Comissão — marcar pago (#999)', { tag: '@critical' }, () => {
  test.use({
    orgInput: { memberOperationCount: 1, memberOperationOperationalStatus: 'operational' },
  })

  test('AC-03: lote por membro/período move pendente→pago e fica imutável', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Corte Para Pagar',
      amountCents: 2500,
      liquidationStatus: 'pendente',
    })
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Barba Para Pagar',
      amountCents: 1500,
      liquidationStatus: 'pendente',
    })

    await authedPage.goto(`/reports/commissions?member=${proUser}`)
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByText('Corte Para Pagar')).toBeVisible()
    await expect(authedPage.getByText('R$ 40,00').first()).toBeVisible()

    const pendingRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Para Pagar' })
    await expect(pendingRow.first().getByText('Pendente')).toBeVisible()

    await authedPage.getByLabel('Comprovante').fill('pix://comprovante-123')
    await authedPage.getByRole('button', { name: 'Marcar pago' }).click()

    const paidRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Para Pagar' })
    await expect(paidRow.first().getByText('Pago')).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByRole('button', { name: 'Marcar pago' })).toBeHidden()
    await expect(paidRow.getByText('Pendente')).toBeHidden()
  })

  test('AC-03: comanda já paga não reabre — guarda de imutabilidade no reopen', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Ja Paga',
      amountCents: 2000,
      liquidationStatus: 'pago',
    })

    await authedPage.goto(`/reports/commissions?member=${proUser}`)
    const paidRow = authedPage.getByRole('listitem').filter({ hasText: 'Comissao Ja Paga' })
    await expect(paidRow).toBeVisible()
    await expect(paidRow.getByText('Pago')).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Marcar pago' })).toBeHidden()
  })
})
