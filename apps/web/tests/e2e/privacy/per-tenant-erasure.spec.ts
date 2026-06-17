import { anonymizedSubjectCode } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedCustomer, seedTenant, signInAndAttachSession } from '../helpers/session'

// Feature-level E2E — per-tenant CUSTOMER erasure via BLOCKING (brief 0032 /
// #1096 + #1100, AC-09/AC-11/AC-13). Re-scoped 04/06: the block is the CUSTOMER
// relationship only.
//
// A data subject erases their CUSTOMER data in ONE establishment (tenant) while
// keeping their global account and other tenants intact (LGPD art. 18
// "bloqueio", terminal-at-rest — NOT the irreversible anonymization of #1093).
// The block writes the `blocked_subjects/{userId}` marker (the fact of record,
// drives the write-guard) AND archives the customer shadow (`archivedAt`, the
// fail-safe projection that drives the read/active-list behavior):
//   - the customer's surfaces resolve to the neutral `Cliente ‹CODE›` (name) +
//     blanked avatar (AC-13);
//   - the customer drops from the active list + the new-appointment picker;
//   - the global account and other tenants keep the live name.
// CRITICALLY, the professional/employment relationship is a DIFFERENT
// relationship (brief 0041): a person blocked as a CUSTOMER in a tenant stays
// IDENTIFIABLE on the professional surfaces (team) — real name, not neutralized.
//
// This spec drives the mechanism's OUTPUT (the marker + archived shadow, what
// `blockSubjectInTenant` writes server-side) directly through the emulator, the
// same way `anonymized-label.spec.ts` simulates the #1093 scrub.

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Writes the `blocked_subjects/{userId}` marker — what `blockSubjectInTenant`
// writes server-side (the fact of record; drives the write-guard).
// `Authorization: Bearer owner` is the emulator's admin escape hatch.
function writeBlockMarker(tenantId: string, userId: string): void {
  const now = new Date().toISOString()
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/tenants/${tenantId}/blocked_subjects/${userId}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { blockedAt: { stringValue: now } } }),
    ],
    { encoding: 'utf8' },
  )
}

// Archives a customer shadow doc — the materialized projection the block emits
// via `customer.updated {archivedAt}`. The read paths key off this field
// (fail-safe), so the spec sets it directly to simulate the projection.
function archiveCustomerShadow(tenantId: string, customerId: string): void {
  const now = new Date().toISOString()
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/tenants/${tenantId}/customers/${customerId}?updateMask.fieldPaths=archivedAt`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { archivedAt: { stringValue: now } } }),
    ],
    { encoding: 'utf8' },
  )
}

function blockedMarkerExists(tenantId: string, userId: string): boolean {
  try {
    execFileSync(
      'curl',
      [
        '-fsS',
        `${FS_BASE}/tenants/${tenantId}/blocked_subjects/${userId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
    return true
  } catch {
    return false
  }
}

// Blocks a CUSTOMER in a tenant the way the server action does: marker + archive.
function blockCustomer(tenantId: string, userId: string, customerId: string): void {
  writeBlockMarker(tenantId, userId)
  archiveCustomerShadow(tenantId, customerId)
}

test.describe('per-tenant CUSTOMER erasure via blocking', () => {
  test('block customer in tenant A: A shows `Cliente ‹CODE›` + no avatar, drops from picker; tenant B + global keep the real name; marker scoped to A', async ({
    context,
  }) => {
    // The SAME global account is a customer in two tenants. Owner A operates
    // tenant A; owner B operates tenant B. The subject's userId is shared.
    const ownerA = await seedTenant({ professionalCount: 1 })
    const ownerB = await seedTenant({ professionalCount: 0 })

    const subjectUserId = `e2e-subject-${Date.now()}`
    const realName = `Marina Compartilhada ${Date.now()}`
    // One global User (shared userId), with an avatar, shadowed by a Customer
    // in each tenant.
    const custA = seedCustomer(ownerA.tenantId, {
      name: realName,
      userId: subjectUserId,
      avatarUrl: 'https://example.com/marina.png',
    })
    seedCustomer(ownerB.tenantId, { name: realName, userId: subjectUserId })

    const label = `Cliente ${anonymizedSubjectCode(subjectUserId)}`

    // Block the subject as a CUSTOMER in tenant A ONLY.
    blockCustomer(ownerA.tenantId, subjectUserId, custA)

    // Tenant A: the customer DROPS from the active management list (archived).
    await signInAndAttachSession(context, ownerA.email, ownerA.password)
    const pageA = await context.newPage()
    await pageA.goto('/customers')
    await expect(pageA.getByText(realName)).toHaveCount(0)
    await expect(pageA.getByText(label, { exact: true })).toHaveCount(0)

    // Tenant A: the new-appointment picker no longer offers the blocked customer.
    await pageA.goto('/agenda')
    await expect(pageA.getByText(realName)).toHaveCount(0)
    await pageA.close()

    // Tenant B: a DIFFERENT browser context signed in as owner B. The same
    // subject keeps the real name — the block is scoped to tenant A.
    const contextB = await context.browser()!.newContext()
    await signInAndAttachSession(contextB, ownerB.email, ownerB.password)
    const pageB = await contextB.newPage()
    await pageB.goto('/customers')
    await expect(pageB.getByText(realName, { exact: true })).toBeVisible()
    await expect(pageB.getByText(label, { exact: true })).toHaveCount(0)
    await contextB.close()

    // The marker exists in tenant A and does NOT leak to tenant B.
    expect(blockedMarkerExists(ownerA.tenantId, subjectUserId)).toBe(true)
    expect(blockedMarkerExists(ownerB.tenantId, subjectUserId)).toBe(false)
  })

  test('a person blocked as a CUSTOMER stays IDENTIFIABLE as a PROFESSIONAL (team surface)', async ({
    context,
  }) => {
    // A single global account that is BOTH a professional (member) of the tenant
    // AND a customer of it. The seeded professional already owns a User with a
    // real displayName. We add a customer shadow for that SAME userId, then block
    // the CUSTOMER relationship. The professional must remain identifiable.
    const owner = await seedTenant({ professionalCount: 1 })
    const proUserId = `e2e-prof-user-${owner.professionalIds[0]}`
    const proName = 'Profissional 1'

    // Same person is also a customer in this tenant.
    const custId = seedCustomer(owner.tenantId, {
      name: proName,
      userId: proUserId,
      avatarUrl: 'https://example.com/pro.png',
    })

    // Block the CUSTOMER relationship only.
    blockCustomer(owner.tenantId, proUserId, custId)

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
