import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import type { SeededOrg } from '../helpers/session'
import { seedCustomer, seedSubscription, setActiveUnitCookie } from '../helpers/session'

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

    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/dashboard')
    await expect(mrrValue(authedPage)).toHaveText('R$ 100,00')
    await expect(authedPage.getByText('Assinantes ativos')).toBeVisible()

    await setActiveUnitCookie(authedPage.context(), unitB)
    await authedPage.goto('/dashboard')
    await expect(mrrValue(authedPage)).toHaveText('R$ 300,00')
  })
})
