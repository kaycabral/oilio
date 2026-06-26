// E2E for #1118 (brief 0043) — DoD Cenário 2: MRR/assinantes refletem só a
// unidade ativa. Duas assinaturas ativas (uma por unidade, preços distintos);
// o KPI conta só a unidade do contexto. Read-path test → as assinaturas são
// semeadas direto via REST (o create pelo fluxo real é coberto no #1117).

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import type { SeededOrg } from '../helpers/session'
import { seedCustomer, seedSubscription, setActiveUnitCookie } from '../helpers/session'

// Seeds an ACTIVE monthly subscription scoped to `unitId` with `priceCents`.
// A fresh customer backs each subscription (the helper hydrates customerUserId
// from it). The dashboard KPIs read status, unitId and the plan price/cycle.
async function seedActiveSubscription(
  org: SeededOrg,
  unitId: string,
  priceCents: number,
): Promise<string> {
  const customerId = await seedCustomer(org.orgId)
  return seedSubscription(org.orgId, customerId, {
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
  test.use({ orgInput: { unitCount: 2, hasBusinessHours: true } })

  test('MRR reflete só a unidade ativa', async ({ org, authedPage }) => {
    const unitA = org.unitIds[0]!
    const unitB = org.unitIds[1]!
    await seedActiveSubscription(org, unitA, 10000)
    await seedActiveSubscription(org, unitB, 30000)

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
