import { expect, test } from '../fixtures'
import { seedCustomer, seedOrg, seedSubscription, signInAndAttachSession } from '../helpers/session'

test.describe('cross-org isolation (surface)', () => {
  test('owner B never sees org A data — not in the customers list, not by direct URL', async ({
    context,
  }) => {
    const ownerA = await seedOrg({ memberOperationCount: 1 })
    const ownerB = await seedOrg({ memberOperationCount: 0 })

    const aCustomerName = `Cliente A ${Date.now()}`
    const custA = await seedCustomer(ownerA.orgId, { name: aCustomerName })
    const subA = await seedSubscription(ownerA.orgId, custA, {
      planName: 'Plano A',
      status: 'active',
    })

    await signInAndAttachSession(context, ownerA.email, ownerA.password)
    const pageA = await context.newPage()
    await pageA.goto('/customers')
    await expect(pageA.getByText(aCustomerName, { exact: true })).toBeVisible()
    await pageA.close()

    const contextB = await context.browser()!.newContext()
    await signInAndAttachSession(contextB, ownerB.email, ownerB.password)
    const pageB = await contextB.newPage()

    await pageB.goto('/customers')
    await expect(pageB.getByText(aCustomerName, { exact: true })).toHaveCount(0)

    await pageB.goto(`/subscriptions/${subA}`)
    await expect(pageB.getByText(aCustomerName, { exact: true })).toHaveCount(0)
    await expect(pageB.getByRole('button', { name: /renovar|marcar/i })).toHaveCount(0)

    await contextB.close()
  })
})
