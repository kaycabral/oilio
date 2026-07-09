import { expect, test } from '../fixtures'
import { chooseOption } from '../helpers/select'
import {
  seedClosedOrder as seedClosedOrderHelper,
  seedCommission as seedCommissionDoc,
  type SeededOrg,
} from '../helpers/session'

type SeedCommission = {
  attributedUserId: string
  itemName: string
  amountCents: number
  liquidationStatus: 'pendente' | 'pago' | 'auto_split'
  createdAt: string
  itemKind?: 'service' | 'product'
  unitId?: string
}

async function seedCommission(org: SeededOrg, c: SeedCommission): Promise<void> {
  const orderId = await seedClosedOrderHelper({
    orgId: org.orgId,
    unitId: c.unitId ?? org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: c.amountCents * 2,
    closedAt: c.createdAt,
  })
  const liquidationStatus = c.liquidationStatus === 'pago' ? 'pago' : 'pendente'
  await seedCommissionDoc({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: c.amountCents,
    liquidationStatus,
    orderId,
    itemName: c.itemName,
  })
}

type SeedCoveredLine = {
  attributedUserId: string
  name: string
  kind: 'service' | 'product'
  coverage: 'sale' | 'subscription'
  unitPriceCents: number
  quantity: number
}

async function seedClosedOrder(
  org: SeededOrg,
  lines: SeedCoveredLine[],
  closedAt: string,
): Promise<void> {
  for (const l of lines) {
    await seedClosedOrderHelper({
      orgId: org.orgId,
      unitId: org.unitIds[0] ?? 'unit',
      customerId: null,
      attributedUserId: l.attributedUserId,
      totalCents: l.coverage === 'subscription' ? 0 : l.unitPriceCents,
      subtotalCents: l.unitPriceCents,
      coverage: l.coverage,
      closedAt,
    })
  }
}

test.describe('Relatório de comissões (#998)', () => {
  test.use({
    orgInput: { memberOperationCount: 1, memberOperationOperationalStatus: 'operational' },
  })

  test('AC-05: lista comissões do período com valores, status e totais', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    const now = new Date().toISOString()
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Corte Pendente',
      amountCents: 2500,
      liquidationStatus: 'pendente',
      createdAt: now,
    })
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Barba Paga',
      amountCents: 1000,
      liquidationStatus: 'pago',
      createdAt: now,
    })
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Legada',
      amountCents: 500,
      liquidationStatus: 'auto_split',
      createdAt: now,
    })

    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()

    await expect(authedPage.getByText('Corte Pendente')).toBeVisible()
    await expect(authedPage.getByText('Barba Paga')).toBeVisible()
    await expect(authedPage.getByText('Comissao Legada')).toBeVisible()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 10,00').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 40,00').first()).toBeVisible()
    const legacyRow = authedPage.getByRole('listitem').filter({ hasText: 'Comissao Legada' })
    await expect(legacyRow.getByText('Pendente')).toBeVisible()
    await expect(authedPage.getByText('Split automático')).toBeHidden()
  })

  test('filtro por período retorna só registros no range', async ({ org, authedPage }) => {
    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Recente',
      amountCents: 3000,
      liquidationStatus: 'pendente',
      createdAt: new Date().toISOString(),
    })
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Antiga',
      amountCents: 4000,
      liquidationStatus: 'pago',
      createdAt: '2026-01-01T12:00:00.000Z',
    })

    await authedPage.goto('/reports')
    await expect(authedPage.getByText('Comissao Recente')).toBeVisible()
    await expect(authedPage.getByText('Comissao Antiga')).toBeHidden()

    const commissionsForm = authedPage.locator('form', {
      has: authedPage.getByRole('button', { name: 'Filtrar' }),
    })
    await commissionsForm.getByLabel('De', { exact: true }).fill('2026-01-01')
    await commissionsForm.getByRole('button', { name: 'Filtrar' }).click()
    await expect(authedPage.getByText('Comissao Antiga')).toBeVisible({ timeout: 5000 })
  })

  test('empty state: relatório sem dados abre sem erro', async ({ authedPage }) => {
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
    await expect(authedPage.getByText('Nenhum atendimento coberto no período.')).toBeVisible()
  })

  test('AC-05: filtro por status recorta a lista; resumo mostra pendente e pago', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    const now = new Date().toISOString()
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Servico Pendente',
      amountCents: 2500,
      liquidationStatus: 'pendente',
      createdAt: now,
    })
    await seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Servico Pago',
      amountCents: 1000,
      liquidationStatus: 'pago',
      createdAt: now,
    })

    await authedPage.goto('/reports')
    await expect(authedPage.getByText('Servico Pendente')).toBeVisible()
    await expect(authedPage.getByText('Servico Pago')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()

    await chooseOption(authedPage, 'Status', 'Pago')
    await authedPage.getByRole('button', { name: 'Filtrar' }).click()
    await expect(authedPage.getByText('Servico Pago')).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Servico Pendente')).toBeHidden()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
  })

  test('AC-07: atendimentos cobertos contam serviço de assinatura, não a venda', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    const now = new Date().toISOString()
    await seedClosedOrder(
      org,
      [
        {
          attributedUserId: proUser,
          name: 'Corte Coberto',
          kind: 'service',
          coverage: 'subscription',
          unitPriceCents: 5000,
          quantity: 1,
        },
        {
          attributedUserId: proUser,
          name: 'Corte Vendido',
          kind: 'service',
          coverage: 'sale',
          unitPriceCents: 4000,
          quantity: 1,
        },
      ],
      now,
    )

    await authedPage.goto('/reports')
    await expect(
      authedPage.getByRole('heading', { name: 'Atendimentos cobertos por assinatura' }),
    ).toBeVisible()
    const coveredRow = authedPage.getByRole('row').filter({ hasText: 'R$ 50,00' })
    await expect(coveredRow).toBeVisible()
    await expect(coveredRow.getByText('1', { exact: true })).toBeVisible()
  })
})
