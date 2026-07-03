// Feature E2E for #1045 (brief 0028 AC-01/02/03): a MemberOperation is born only
// from the invite-acceptance saga, with a non-null `userId`. Drives the real
// flow against the emulator (no mocks): owner invites role=memberOperation →
// invitee signs in + accepts → the accept saga materializes ONE MemberOperation
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

// List the org's memberOperations from the `member_operations` projection (Postgres,
// post-cutover) and project the fields the saga must set. `userId` surfaces as
// `null` when the column is missing or explicitly null — exactly the
// regression AC-01 forbids.
async function listMemberOperations(orgId: string): Promise<StoredPro[]> {
  const rows = await pgQueryProjection('member_operations', 'org_id', orgId)
  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    userId: typeof row.user_id === 'string' ? row.user_id : null,
  }))
}

test.describe('MemberOperation materializa pelo aceite (#1045)', { tag: '@critical' }, () => {
  test('convite role=memberOperation → aceite → MemberOperation materializa com userId (sem null, sem duplicado)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Owner org with no pre-seeded memberOperations so the assertion below is
    // unambiguous: the only memberOperation after accept is the materialized one.
    const owner = await seedOrg({ unitCount: 1, memberOperationCount: 0 })
    expect(await listMemberOperations(owner.orgId)).toHaveLength(0)

    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: '5511990004567',
      role: 'member_operator',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    // A memberOperation is not a manager, so the post-accept redirect lands on
    // `/agenda` (the org has an appointment unit), not the manager-only Dashboard.
    await expect(page).toHaveURL(/\/agenda/, { timeout: 10_000 })

    // Membership exists with role memberOperation (the saga's first step).
    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m).not.toBeNull()
    expect(m!.role).toBe('member_operator')

    // Exactly ONE MemberOperation projection materialized, carrying the
    // invitee uid as a non-null userId.
    const pros = await listMemberOperations(owner.orgId)
    expect(pros).toHaveLength(1)
    expect(pros[0]!.userId).toBe(invitee.uid)
    expect(pros[0]!.userId).not.toBeNull()
  })

  test('aceite com role manager NÃO materializa MemberOperation (saga só dispara pra memberOperation)', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 1, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: '5511990005678',
      role: 'manager',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m!.role).toBe('manager')
    expect(await listMemberOperations(owner.orgId)).toHaveLength(0)
  })
})
