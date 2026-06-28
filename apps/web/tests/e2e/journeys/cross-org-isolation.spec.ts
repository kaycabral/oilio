import { expect, test } from '../fixtures'
import { seedCustomer, seedOrg, seedSubscription, signInAndAttachSession } from '../helpers/session'

// Feature-level E2E — cross-org isolation on the SURFACE (brief 0065 § Grupo A,
// AC-01). Post-cutover (brief 0062) the only thing standing between two orgs'
// data is the Postgres RLS policy (the Firestore Security Rules are gone). The
// RLS already has integration coverage (it refuses cross-org reads at the DB);
// this spec proves the same isolation HOLDS at the browser level: two distinct
// owners, two distinct orgs, and owner B never sees owner A's data — neither in
// a list nor by guessing A's record id in the URL.
//
// Pattern mirrors `privacy/per-org-erasure.spec.ts`: seed two owners with
// `seedOrg`, then sign each into its OWN browser context so the sessions are
// fully isolated (a shared context would leak the `__session` cookie).

test.describe('cross-org isolation (surface)', () => {
  test('owner B never sees org A data — not in the customers list, not by direct URL', async ({
    context,
  }) => {
    const ownerA = await seedOrg({ memberOperationCount: 1 })
    const ownerB = await seedOrg({ memberOperationCount: 0 })

    // Org A owns a customer + a subscription. Their ids are what we'll try to
    // reach from org B's session.
    const aCustomerName = `Cliente A ${Date.now()}`
    const custA = await seedCustomer(ownerA.orgId, { name: aCustomerName })
    const subA = await seedSubscription(ownerA.orgId, custA, {
      planName: 'Plano A',
      status: 'active',
    })

    // ── Owner A: sees its own customer (sanity — the data exists and renders). ──
    await signInAndAttachSession(context, ownerA.email, ownerA.password)
    const pageA = await context.newPage()
    await pageA.goto('/customers')
    await expect(pageA.getByText(aCustomerName, { exact: true })).toBeVisible()
    await pageA.close()

    // ── Owner B: a DIFFERENT context (isolated session). Must see NONE of A. ──
    const contextB = await context.browser()!.newContext()
    await signInAndAttachSession(contextB, ownerB.email, ownerB.password)
    const pageB = await contextB.newPage()

    // (1) A's customer never appears in B's list.
    await pageB.goto('/customers')
    await expect(pageB.getByText(aCustomerName, { exact: true })).toHaveCount(0)

    // (2) Guessing A's subscription id in the URL is refused. The detail page
    //     does `loadSubscriptionDetail(id)` then `if (!data) notFound()`; the RLS
    //     read returns nothing for B's org, so B never sees A's subscription —
    //     the customer name (which the page renders in the breadcrumb) is absent.
    await pageB.goto(`/subscriptions/${subA}`)
    await expect(pageB.getByText(aCustomerName, { exact: true })).toHaveCount(0)
    // The SubscriptionDetail surface never renders for B (its manage actions are
    // absent) — confirms notFound() fired rather than A's detail leaking.
    await expect(pageB.getByRole('button', { name: /renovar|marcar/i })).toHaveCount(0)

    await contextB.close()
  })
})
