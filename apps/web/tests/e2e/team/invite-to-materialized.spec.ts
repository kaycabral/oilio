// Feature E2E for #1045 (brief 0028 AC-01/02/03): a Professional is born only
// from the invite-acceptance saga, with a non-null `userId`. Drives the real
// flow against the emulator (no mocks): owner invites role=professional →
// invitee signs in + accepts → the accept saga materializes ONE Professional
// projection carrying `userId`, never null, never duplicated.

import { membershipDocId } from '@/domain'
import { expect, test } from '../fixtures'
import {
  pgQueryProjection,
  readMembership,
  seedAuthUser,
  seedInvite,
  seedOrg,
  signInAndAttachSession,
} from '../helpers/session'

type StoredPro = { id: string; userId: string | null }

// List the org's professionals from the `professionals` projection (Postgres,
// post-cutover) and project the fields the saga must set. `userId` surfaces as
// `null` when the column is missing or explicitly null — exactly the
// regression AC-01 forbids.
async function listProfessionals(orgId: string): Promise<StoredPro[]> {
  const rows = await pgQueryProjection('professionals', 'org_id', orgId)
  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    userId: typeof row.user_id === 'string' ? row.user_id : null,
  }))
}

test.describe('Professional materializa pelo aceite (#1045)', { tag: '@critical' }, () => {
  test('convite role=professional → aceite → Professional materializa com userId (sem null, sem duplicado)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Owner org with no pre-seeded professionals so the assertion below is
    // unambiguous: the only professional after accept is the materialized one.
    const owner = await seedOrg({ unitCount: 1, professionalCount: 0 })
    expect(await listProfessionals(owner.orgId)).toHaveLength(0)

    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: invitee.email,
      role: 'professional',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    // Membership exists with role professional (the saga's first step).
    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m).not.toBeNull()
    expect(m!.role).toBe('professional')

    // Exactly ONE Professional projection materialized, carrying the
    // invitee uid as a non-null userId.
    const pros = await listProfessionals(owner.orgId)
    expect(pros).toHaveLength(1)
    expect(pros[0]!.userId).toBe(invitee.uid)
    expect(pros[0]!.userId).not.toBeNull()
  })

  test('aceite com role manager NÃO materializa Professional (saga só dispara pra professional)', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 1, professionalCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: invitee.email,
      role: 'manager',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m!.role).toBe('manager')
    expect(await listProfessionals(owner.orgId)).toHaveLength(0)
  })
})
