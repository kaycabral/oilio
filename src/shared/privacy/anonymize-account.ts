import { buildUserAnonymizationScrub } from '@/domain'
import { readAsSubject, readUnderRls } from '@/shared/db/pg/rls-read'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { deleteInvitePii } from '@/shared/org/invite-read'
import { deleteMemberOperationPii } from '@/shared/org/member-operation-read'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'
import 'server-only'

function anonymizationColumnPatch(now: string): Record<string, unknown> {
  const scrub = buildUserAnonymizationScrub(now)
  return {
    display_name: scrub.displayName,
    mobile: scrub.mobile,
    email: scrub.email,
    birth_date: scrub.birthDate,
    tax_identity: scrub.taxIdentity,
    bio: scrub.bio,
    specialties: scrub.specialties,
    avatar_url: scrub.avatarUrl,
    anonymized_at: scrub.anonymizedAt,
  }
}

export type AnonymizeAccountResult = {
  scrubbedAccount: boolean
  scrubbedPiiDocs: number
  hadActiveSubscription: boolean
}

export async function anonymizeAccount(userId: string): Promise<AnonymizeAccountResult> {
  if (!userId) return { scrubbedAccount: false, scrubbedPiiDocs: 0, hadActiveSubscription: false }

  const now = new Date().toISOString()

  const orgIds = await enumerateSubjectOrgs(userId)

  let hadActiveSubscription = false
  for (const orgId of orgIds) {
    const cascade = await eraseCustomerCascadeInOrg(orgId, userId)
    if (cascade.hadActiveSubscription) hadActiveSubscription = true
  }

  const scrubbedPiiDocs = await scrubOrgPii(orgIds, userId)

  const scrubbed = await patchUser(userId, anonymizationColumnPatch(now), now)
  if (!scrubbed) {
    return { scrubbedAccount: false, scrubbedPiiDocs, hadActiveSubscription }
  }

  await emitPiiEvent('pii_anonymized', {
    orgId: null,
    subjectRef: userId,
    scope: 'account',
  })

  return { scrubbedAccount: true, scrubbedPiiDocs, hadActiveSubscription }
}

async function enumerateSubjectOrgs(userId: string): Promise<string[]> {
  const linkedOrgIds = await listLinkedOrgIds(userId)
  const orgIds = new Set(linkedOrgIds)

  const membershipOrgs = await readAsSubject<{ org_id: string }>(userId, (client) =>
    client
      .query<{ org_id: string }>('SELECT org_id FROM memberships WHERE user_id = $1', [userId])
      .then((res) => res.rows),
  )
  for (const m of membershipOrgs) orgIds.add(m.org_id)

  const user = await getUserById(userId)
  if (user?.currentOrgId) orgIds.add(user.currentOrgId)

  return [...orgIds]
}

async function scrubOrgPii(orgIds: string[], userId: string): Promise<number> {
  let deleted = 0
  for (const orgId of orgIds) {
    const proIds = await readUnderRls<{ id: string }>(orgId, (client) =>
      client
        .query<{
          id: string
        }>('SELECT id FROM member_operations WHERE org_id = $1 AND user_id = $2', [orgId, userId])
        .then((res) => res.rows),
    )
    for (const pro of proIds) {
      await deleteMemberOperationPii(orgId, pro.id)
      deleted += 1
    }

    const inviteIds = await readUnderRls<{ id: string }>(orgId, (client) =>
      client
        .query<{
          id: string
        }>('SELECT id FROM invites WHERE org_id = $1 AND accepted_by_uid = $2', [orgId, userId])
        .then((res) => res.rows),
    )
    for (const inv of inviteIds) {
      await deleteInvitePii(orgId, inv.id)
      deleted += 1
    }
  }

  return deleted
}
