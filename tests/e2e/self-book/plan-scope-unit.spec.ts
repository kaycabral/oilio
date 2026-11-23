import { expect, test } from '../fixtures'
import { seedCustomer, seedService, seedSubscription } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe(
  'brief 0019 — Feature-level DoD § Scenario 1 (unitAllowlist)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('plano com unitAllowlist filtra self-book do assinante; avulso vê todas', async ({
      org,
      authedPage,
      browser,
    }) => {
      const slug = orgSlug(org.orgId)
      const allowedUnitId = org.unitIds[0]!
      const blockedUnitId = org.unitIds[1]!

      await seedService(org.orgId, {
        name: 'Corte Alvorada',
        publicVisible: true,
        unitIds: [allowedUnitId],
      })
      await seedService(org.orgId, {
        name: 'Corte Djalma',
        publicVisible: true,
        unitIds: [blockedUnitId],
      })

      const customerId = await seedCustomer(org.orgId, {
        name: 'Cliente Scoped',
        userId: org.uid,
      })
      await seedSubscription(org.orgId, customerId, {
        planName: 'Plano Alvorada Only',
        unitAllowlist: [allowedUnitId],
      })

      const subscribed = new PublicBookingPage(authedPage, slug)
      await subscribed.gotoCatalog()
      await expect(authedPage.getByRole('heading', { name: /escolha uma unidade/i })).toHaveCount(0)
      await expect(authedPage.getByText('Corte Alvorada')).toBeVisible()
      await expect(authedPage.getByText('Corte Djalma')).toHaveCount(0)
      await expect(
        authedPage.getByRole('note', { name: 'Seu plano cobre', exact: true }),
      ).toBeVisible()

      const guestContext = await browser.newContext()
      const guestPage = await guestContext.newPage()
      const guest = new PublicBookingPage(guestPage, slug)
      await guest.gotoCatalog()
      await expect(guestPage.getByRole('heading', { name: /escolha uma unidade/i })).toBeVisible()
      await expect(guestPage.getByText('Unidade 1')).toBeVisible()
      await expect(guestPage.getByText('Unidade 2')).toBeVisible()
      await expect(
        guestPage.getByRole('note', { name: 'Seu plano cobre', exact: true }),
      ).toHaveCount(0)
      await guestContext.close()
    })
  },
)
