import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { seedAppointment, seedCustomer, seedOpenOrder, seedUnit } from '../helpers/session'

async function assertNoCrash(authedPage: Page, path: string) {
  const res = await authedPage.goto(path)
  expect(res?.status() ?? 0, `${path} returned a server error`).toBeLessThan(500)
  await expect(authedPage.getByText('Application error')).toHaveCount(0)
  await expect(authedPage.getByText(/Unhandled Runtime Error/)).toHaveCount(0)
}

const SURFACES = [
  '/agenda',
  '/orders',
  '/dashboard',
  '/catalog',
  '/customers',
  '/reports',
  '/team',
  '/plans',
  '/subscriptions',
  '/organizations',
  '/units',
]

test.describe('Org sem unidades — app navegável (regressão)', { tag: '@critical' }, () => {
  test.describe('nunca teve unidade', () => {
    test.use({ orgInput: { unitCount: 0 } })
    for (const path of SURFACES) {
      test(`${path} renderiza sem crash`, async ({ authedPage }) => {
        await assertNoCrash(authedPage, path)
      })
    }

    test('sem unidade não crasha; renderiza empty-state sem unidade ativa', async ({
      authedPage,
    }) => {
      await authedPage.goto('/orders')
      await expect(authedPage).toHaveURL(/\/orders$/)
      await expect(authedPage.getByText('Nenhuma unidade ativa')).toBeVisible()
      await expect(authedPage.getByText('Application error')).toHaveCount(0)
      await expect(authedPage.getByText(/Unhandled Runtime Error/)).toHaveCount(0)
    })
  })

  test.describe('tinha unidade com dados, depois arquivada', () => {
    test.use({ orgInput: { unitCount: 0, memberOperationCount: 1 } })

    test('agenda/orders/dashboard não crasham após arquivar a única unidade', async ({
      org,
      authedPage,
    }) => {
      const unitId = await seedUnit(org.orgId, { archivedAt: new Date().toISOString() })
      const customerId = await seedCustomer(org.orgId, { name: `Cliente NU ${Date.now()}` })
      const start = new Date(Date.now() + 86_400_000).toISOString()
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        memberOperationId: org.memberOperationIds[0]!,
        customerId,
        serviceId: 'e2e-svc',
        startAt: start,
        endAt: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
        status: 'scheduled',
      })
      await seedOpenOrder({ orgId: org.orgId, unitId, customerId, attributedUserId: org.uid })

      for (const path of SURFACES) {
        await assertNoCrash(authedPage, path)
      }
    })
  })
})
