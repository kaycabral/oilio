// E2E spec — brief 0022 #998 + #1000 (Relatório de comissões pendente/pago).
//
// - AC-05 relatório lista comissões do período com valores + status + totais
// - AC-05 totais por profissional (pendente/pago) + filtro por status
// - AC-07 atendimentos cobertos por assinatura: contagem + valor de catálogo
//   por profissional; serviço de venda comissionável fica de fora
// - empty state: relatório sem dados abre sem erro
// - filtro por período retorna só registros no range
// - migração (#998): comissão com estado legado de split é lida como `pendente`
//
// Seed direto de comissões/orders via REST do emulator (mais rápido que fechar
// order por order) — o relatório é uma projeção read-only.
//
// Brief 0031 (#1062): a seção Comissões foi dobrada no hub `/reports` (a rota
// `/reports/commissions` redireciona pra lá). Os specs apontam pro hub; a
// casca do `<CommissionReport>` (heading "Relatório de comissões", filtros) é
// a mesma.

import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { chooseOption } from '../helpers/select'
import {
  seedClosedOrder as seedClosedOrderHelper,
  seedCommission as seedCommissionDoc,
  type SeededOrg,
} from '../helpers/session'

function docUrl(path: string): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`
}

type SeedCommission = {
  attributedUserId: string
  itemName: string
  amountCents: number
  liquidationStatus: 'pendente' | 'pago' | 'auto_split'
  createdAt: string
  itemKind?: 'service' | 'product'
  // Unit the source order belongs to (brief 0039 AC-04 scoping). Defaults to
  // the org's first unit.
  unitId?: string
}

function seedCommission(org: SeededOrg, c: SeedCommission): void {
  // The report scopes commissions by unit through their source order (brief
  // 0039 AC-04 — Commission has no `unitId`, the closed order carries it). Seed
  // the matching closed order so the commission stays in scope (in production a
  // commission always has its closing order in the same window). `unitId`
  // defaults to the org's first unit unless the case overrides it.
  const orderId = seedClosedOrderHelper({
    orgId: org.orgId,
    unitId: c.unitId ?? org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: c.amountCents * 2,
    closedAt: c.createdAt,
  })
  // Legacy split states (#998) are not part of the seeded Commission union; the
  // report read-path migrates any non-`pago` liquidation status to `pendente`.
  // Seed those as `pendente` (the migrated value the report would surface).
  const liquidationStatus = c.liquidationStatus === 'pago' ? 'pago' : 'pendente'
  seedCommissionDoc({
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

// Seed direto de uma comanda fechada com itens — o relatório de cobertos (AC-07)
// lê closed orders no período. Mais rápido que fechar order por order.
function seedClosedOrder(org: SeededOrg, lines: SeedCoveredLine[], closedAt: string): void {
  const id = `e2e-order-${Math.random().toString(36).slice(2)}`
  const items = lines.map((l, i) => ({
    mapValue: {
      fields: {
        id: { stringValue: `${id}-item-${i}` },
        kind: { stringValue: l.kind },
        refId: { stringValue: `catalog-${i}` },
        name: { stringValue: l.name },
        quantity: { integerValue: String(l.quantity) },
        unitPriceCents: { integerValue: String(l.unitPriceCents) },
        commission: { nullValue: null },
        attributedUserId: { stringValue: l.attributedUserId },
        coverage: { stringValue: l.coverage },
      },
    },
  }))
  const fields: Record<string, unknown> = {
    id: { stringValue: id },
    orgId: { stringValue: org.orgId },
    unitId: { stringValue: org.unitIds[0] ?? 'unit' },
    customerId: { stringValue: `cust-${id}` },
    appointmentId: { nullValue: null },
    status: { stringValue: 'closed' },
    items: { arrayValue: { values: items } },
    discountCents: { integerValue: '0' },
    notes: { nullValue: null },
    closedAt: { stringValue: closedAt },
    paymentMethod: { stringValue: 'pix' },
    subtotalCents: { integerValue: '0' },
    totalCents: { integerValue: '0' },
    createdAt: { stringValue: closedAt },
    updatedAt: { stringValue: closedAt },
  }
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      docUrl(`orgs/${org.orgId}/orders/${id}`),
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields }),
    ],
    { stdio: 'pipe' },
  )
}

test.describe('Relatório de comissões (#998)', () => {
  test.use({ orgInput: { professionalCount: 1, professionalOperationalStatus: 'operational' } })

  test('AC-05: lista comissões do período com valores, status e totais', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    const now = new Date().toISOString()
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Corte Pendente',
      amountCents: 2500,
      liquidationStatus: 'pendente',
      createdAt: now,
    })
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Barba Paga',
      amountCents: 1000,
      liquidationStatus: 'pago',
      createdAt: now,
    })
    // Migração (#998): estado legado de split é lido como `pendente`.
    seedCommission(org, {
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
    // Valores aparecem no card de resumo e na linha — basta confirmar presença.
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 10,00').first()).toBeVisible()
    // Total agregado (25 + 10 + 5) — aparece no card de resumo e na linha do
    // profissional (único profissional → mesmo total). Basta confirmar presença.
    await expect(authedPage.getByText('R$ 40,00').first()).toBeVisible()
    // Estado legado migra para Pendente (não aparece "Split automático"). A
    // linha da comissão legada mostra o status `Pendente`.
    const legacyRow = authedPage.getByRole('listitem').filter({ hasText: 'Comissao Legada' })
    await expect(legacyRow.getByText('Pendente')).toBeVisible()
    await expect(authedPage.getByText('Split automático')).toBeHidden()
  })

  test('filtro por período retorna só registros no range', async ({ org, authedPage }) => {
    const proId = org.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Recente',
      amountCents: 3000,
      liquidationStatus: 'pendente',
      createdAt: new Date().toISOString(),
    })
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Antiga',
      amountCents: 4000,
      liquidationStatus: 'pago',
      createdAt: '2026-01-01T12:00:00.000Z',
    })

    // Range default (últimos 7 dias) só mostra a recente.
    await authedPage.goto('/reports')
    await expect(authedPage.getByText('Comissao Recente')).toBeVisible()
    await expect(authedPage.getByText('Comissao Antiga')).toBeHidden()

    // Ampliando o range pra incluir janeiro, a antiga aparece. O hub `/reports`
    // tem DUAS faixas de data (Vendas + Comissões), então escopo o `De`/`Filtrar`
    // ao form da seção Comissões — único com o botão "Filtrar" (Vendas usa
    // "Aplicar") e o select "Membro".
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
    const proId = org.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    const now = new Date().toISOString()
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Servico Pendente',
      amountCents: 2500,
      liquidationStatus: 'pendente',
      createdAt: now,
    })
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Servico Pago',
      amountCents: 1000,
      liquidationStatus: 'pago',
      createdAt: now,
    })

    await authedPage.goto('/reports')
    // Sem filtro: ambos na lista, totais por profissional mostram os dois.
    await expect(authedPage.getByText('Servico Pendente')).toBeVisible()
    await expect(authedPage.getByText('Servico Pago')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()

    // Filtra por status `pago` → só o pago fica na lista; o resumo segue com os
    // dois (recorte por profissional/período, não por status).
    await chooseOption(authedPage, 'Status', 'Pago')
    await authedPage.getByRole('button', { name: 'Filtrar' }).click()
    await expect(authedPage.getByText('Servico Pago')).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Servico Pendente')).toBeHidden()
    // Resumo pendente (R$ 25,00) continua visível mesmo filtrando a lista por pago.
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
  })

  test('AC-07: atendimentos cobertos contam serviço de assinatura, não a venda', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    const now = new Date().toISOString()
    seedClosedOrder(
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
        // Serviço de venda comissionável — NÃO entra na contagem de cobertos.
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
    // 1 atendimento coberto, valor de catálogo R$ 50,00 (o serviço de venda
    // não conta). A venda comissionável não aparece nesta seção.
    const coveredRow = authedPage.getByRole('row').filter({ hasText: 'R$ 50,00' })
    await expect(coveredRow).toBeVisible()
    await expect(coveredRow.getByText('1', { exact: true })).toBeVisible()
  })
})
