// E2E for #1118 (brief 0043) — DoD Cenário 2: MRR/assinantes refletem só a
// unidade ativa. Duas assinaturas ativas (uma por unidade, preços distintos);
// o KPI conta só a unidade do contexto. Read-path test → as assinaturas são
// semeadas direto via REST (o create pelo fluxo real é coberto no #1117).

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import type { SeededTenant } from '../helpers/session'
import { seedCustomer, seedSubscription, setActiveUnitCookie } from '../helpers/session'

// Seeds an ACTIVE monthly subscription scoped to `unitId` with `priceCents`.
// A fresh customer backs each subscription (the helper hydrates customerUserId
// from it). The dashboard KPIs read status, unitId and the plan price/cycle.
function seedActiveSubscription(tenant: SeededTenant, unitId: string, priceCents: number): string {
  const customerId = seedCustomer(tenant.tenantId)
  return seedSubscription(tenant.tenantId, customerId, {
    status: 'active',
    unitId,
    priceCents,
  })
}

// CardDescription("MRR") + sibling CardTitle holds the formatted value.
function mrrValue(page: Page) {
  return page.getByText('MRR', { exact: true }).locator('xpath=following-sibling::*[1]')
}

test.describe('Dashboard — MRR por unidade (#1118)', () => {
  test.use({ tenantInput: { unitCount: 2, hasBusinessHours: true } })

  test('MRR reflete só a unidade ativa', async ({ tenant, authedPage }) => {
    const unitA = tenant.unitIds[0]!
    const unitB = tenant.unitIds[1]!
    seedActiveSubscription(tenant, unitA, 10000)
    seedActiveSubscription(tenant, unitB, 30000)

    // Unidade A ativa → MRR conta só A.
    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/dashboard')
    await expect(mrrValue(authedPage)).toHaveText('R$ 100,00')
    await expect(authedPage.getByText('Assinantes ativos')).toBeVisible()

    // Troca pra B → MRR passa a contar só B (sem vazar A).
    await setActiveUnitCookie(authedPage.context(), unitB)
    await authedPage.goto('/dashboard')
    await expect(mrrValue(authedPage)).toHaveText('R$ 300,00')
  })
})
