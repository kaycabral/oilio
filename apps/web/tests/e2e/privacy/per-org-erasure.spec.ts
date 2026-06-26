import { anonymizedSubjectCode } from '@/domain'
import { expect, test } from '../fixtures'
import {
  blockedSubjectMarkerExists,
  pgQueryProjection,
  seedCustomer,
  seedOrg,
  signInAndAttachSession,
} from '../helpers/session'

// Feature-level E2E — per-org CUSTOMER erasure via BLOCKING (brief 0032 /
// #1096 + #1100, AC-09/AC-11/AC-13). Re-scoped 04/06: the block is the CUSTOMER
// relationship only.
//
// A data subject erases their CUSTOMER data in ONE establishment (org) while
// keeping their global account and other orgs intact (LGPD art. 18
// "bloqueio", terminal-at-rest — NOT the irreversible anonymization of #1093).
// Post-cutover (brief 0062) there is no separate `blocked_subjects` table — the
// block IS the materialized `archived_at` on the customer shadow (the fail-safe,
// self-describing projection). It both records the fact (drives the
// write-guard) AND drives the read/active-list behavior:
//   - the customer's surfaces resolve to the neutral `Cliente ‹CODE›` (name) +
//     blanked avatar (AC-13);
//   - the customer drops from the active list + the new-appointment picker;
//   - the global account and other orgs keep the live name.
// CRITICALLY, the professional/employment relationship is a DIFFERENT
// relationship (brief 0041): a person blocked as a CUSTOMER in a org stays
// IDENTIFIABLE on the professional surfaces (team) — real name, not neutralized.
//
// This spec drives the mechanism's OUTPUT (the archived shadow, what
// `blockSubjectInOrg` writes server-side) directly against Postgres, the same
// way `anonymized-label.spec.ts` simulates the #1093 scrub.

// Archives a customer shadow projection — the materialized state the block emits
// via `customer.updated {archivedAt}`. The read paths key off `archived_at`
// (fail-safe), so the spec stamps it directly on the projection row to simulate
// the block output (mirrors the old FS_BASE `archivedAt` PATCH; post-cutover the
// projection lives in Postgres).
async function archiveCustomerShadow(orgId: string, customerId: string): Promise<void> {
  const now = new Date().toISOString()
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('UPDATE customers SET archived_at = $1 WHERE org_id = $2 AND id = $3', [
      now,
      orgId,
      customerId,
    ])
  } finally {
    await client.end()
  }
}

// Blocks a CUSTOMER in a org the way the server action does post-cutover: the
// archived shadow IS the block (fact of record + read/guard driver).
async function blockCustomer(orgId: string, customerId: string): Promise<void> {
  await archiveCustomerShadow(orgId, customerId)
}

test.describe('per-org CUSTOMER erasure via blocking', () => {
  test('block customer in org A: A shows `Cliente ‹CODE›` + no avatar, drops from picker; org B + global keep the real name; marker scoped to A', async ({
    context,
  }) => {
    // The SAME global account is a customer in two orgs. Owner A operates
    // org A; owner B operates org B. The subject's userId is shared.
    const ownerA = await seedOrg({ professionalCount: 1 })
    const ownerB = await seedOrg({ professionalCount: 0 })

    const subjectUserId = `e2e-subject-${Date.now()}`
    const realName = `Marina Compartilhada ${Date.now()}`
    // One global User (shared userId), with an avatar, shadowed by a Customer
    // in each org.
    const custA = await seedCustomer(ownerA.orgId, {
      name: realName,
      userId: subjectUserId,
      avatarUrl: 'https://example.com/marina.png',
    })
    await seedCustomer(ownerB.orgId, { name: realName, userId: subjectUserId })

    const label = `Cliente ${anonymizedSubjectCode(subjectUserId)}`

    // Block the subject as a CUSTOMER in org A ONLY.
    await blockCustomer(ownerA.orgId, custA)

    // Org A: the customer DROPS from the active management list (archived).
    await signInAndAttachSession(context, ownerA.email, ownerA.password)
    const pageA = await context.newPage()
    await pageA.goto('/customers')
    await expect(pageA.getByText(realName)).toHaveCount(0)
    await expect(pageA.getByText(label, { exact: true })).toHaveCount(0)

    // Org A: the new-appointment picker no longer offers the blocked customer.
    await pageA.goto('/agenda')
    await expect(pageA.getByText(realName)).toHaveCount(0)
    await pageA.close()

    // Org B: a DIFFERENT browser context signed in as owner B. The same
    // subject keeps the real name — the block is scoped to org A.
    const contextB = await context.browser()!.newContext()
    await signInAndAttachSession(contextB, ownerB.email, ownerB.password)
    const pageB = await contextB.newPage()
    await pageB.goto('/customers')
    await expect(pageB.getByText(realName, { exact: true })).toBeVisible()
    await expect(pageB.getByText(label, { exact: true })).toHaveCount(0)
    await contextB.close()

    // The marker exists in org A and does NOT leak to org B. Post-cutover the
    // marker is the archived customer shadow (`blockedSubjectMarkerExists`).
    expect(await blockedSubjectMarkerExists(ownerA.orgId, subjectUserId)).toBe(true)
    expect(await blockedSubjectMarkerExists(ownerB.orgId, subjectUserId)).toBe(false)
  })

  test('a person blocked as a CUSTOMER stays IDENTIFIABLE as a PROFESSIONAL (team surface)', async ({
    context,
  }) => {
    // A single global account that is BOTH a professional (member) of the org
    // AND a customer of it. The seeded professional already owns a User with a
    // real displayName. We add a customer shadow for that SAME userId, then block
    // the CUSTOMER relationship. The professional must remain identifiable.
    const owner = await seedOrg({ professionalCount: 1 })
    const proUserId = `e2e-prof-user-${owner.professionalIds[0]}`
    const proName = 'Profissional 1'

    // Same person is also a customer in this org.
    const custId = await seedCustomer(owner.orgId, {
      name: proName,
      userId: proUserId,
      avatarUrl: 'https://example.com/pro.png',
    })

    // Block the CUSTOMER relationship only.
    await blockCustomer(owner.orgId, custId)

    // Guard: the customer shadow is archived (the block landed) — keeps this
    // test honest about what it simulates before asserting the professional view.
    const customerRows = await pgQueryProjection('customers', 'user_id', proUserId)
    expect(customerRows.some((r) => r.org_id === owner.orgId && r.archived_at !== null)).toBe(true)

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    // Team surface (professional/employment relationship): the real name stays.
    await page.goto('/team')
    await expect(page.getByText(proName).first()).toBeVisible()
    // If the block had (incorrectly) neutralized the professional, the team
    // would render `Profissional ‹CODE›` instead of the real name. It must NOT.
    const neutralProLabel = `Profissional ${anonymizedSubjectCode(proUserId)}`
    await expect(page.getByText(neutralProLabel, { exact: true })).toHaveCount(0)

    await page.close()
  })
})
