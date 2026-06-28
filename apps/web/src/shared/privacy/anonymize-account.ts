import { buildUserAnonymizationScrub } from '@/domain'
import { readAsSubject, readUnderRls } from '@/shared/db/pg/rls-read'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { deleteInvitePii } from '@/shared/org/invite-read'
import { deleteMemberOperationPii } from '@/shared/org/member-operation-read'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'
import 'server-only'

// Maps the domain anonymization scrub to the snake_case `users` columns for a
// single atomic `patchUser` UPDATE. `updatedAt` is written by `patchUser` itself,
// so it is omitted here. Setting `anonymized_at` alongside `whatsapp`/`birth_date`
// → null in ONE statement satisfies the `users_anonymized_pii_scrubbed` CHECK
// (anonymized ⇒ PII null) — there is no intermediate violating state.
function anonymizationColumnPatch(now: string): Record<string, unknown> {
  const scrub = buildUserAnonymizationScrub(now)
  return {
    display_name: scrub.displayName,
    whatsapp: scrub.whatsapp,
    email: scrub.email,
    birth_date: scrub.birthDate,
    tax_identity: scrub.taxIdentity,
    bio: scrub.bio,
    specialties: scrub.specialties,
    avatar_url: scrub.avatarUrl,
    anonymized_at: scrub.anonymizedAt,
  }
}

// Account-level (global) PII anonymization — brief 0032 / #1093 (AC-01/02/04).
//
// The person's name lived ONLY in the global `users/{uid}` doc (a plain CRUD
// doc, NOT event-sourced). Anonymizing = a direct, irreversible scrub of that
// doc plus the subject's deletable per-org `_pii` docs. Records
// (orders/commissions/memberships/memberOperations/invites) keep their `userId`
// pointer untouched (AC-04 retention); they resolve to a neutral label because
// the account is anonymized (display handled by #1095). There is no reverse
// map (art. 12) and no per-record sever / anonymization event (that was the
// per-org model, deferred — AC-08).

export type AnonymizeAccountResult = {
  // Whether the global account doc was scrubbed (false only for an anonymous
  // customer with no `users/{uid}` — the `userId` was null/empty: no-op).
  scrubbedAccount: boolean
  // Count of per-org `_pii` docs deleted (member_operations_pii + invites_pii).
  scrubbedPiiDocs: number
  // Whether the subject had an active subscription (in any enumerated org)
  // that the erasure cascade cancelled (brief 0032 / #1101, AC-12). Surfaced for
  // the informed-consent fact.
  hadActiveSubscription: boolean
}

// Irreversibly anonymizes the global account `userId` and scrubs the subject's
// per-org `_pii` docs. An anonymous customer (`userId` null/'') is a no-op.
// Idempotent: re-running over an already-anonymized account re-applies the
// neutral scrub (no PII is ever reconstructed).
export async function anonymizeAccount(userId: string): Promise<AnonymizeAccountResult> {
  // Anonymous customer (walk-in with no platform account) — nothing to scrub.
  if (!userId) return { scrubbedAccount: false, scrubbedPiiDocs: 0, hadActiveSubscription: false }

  const now = new Date().toISOString()

  // Enumerate the subject's orgs WITHOUT a cross-org query (ADR 0004).
  const orgIds = await enumerateSubjectOrgs(userId)

  // 1. Erasure cascade (brief 0032 / #1101): across the subject's enumerated
  //    orgs, cancel each active subscription immediately (+ stop its pending
  //    charges) and cancel their future appointments. Saga + idempotent + errors
  //    surface (AC-12 / AC-14).
  let hadActiveSubscription = false
  for (const orgId of orgIds) {
    const cascade = await eraseCustomerCascadeInOrg(orgId, userId)
    if (cascade.hadActiveSubscription) hadActiveSubscription = true
  }

  // 2. Scrub the per-org `_pii` docs. Within each org: member_operations_pii
  //    (matched by `memberOperations.userId`) and invites_pii (by `acceptedByUid`).
  const scrubbedPiiDocs = await scrubOrgPii(orgIds, userId)

  // 3. Scrub the global account record — the single place the name existed. If
  //    the user row is gone (deleted stub), `patchUser` updates zero rows and
  //    there's nothing left to anonymize.
  const scrubbed = await patchUser(userId, anonymizationColumnPatch(now), now)
  if (!scrubbed) {
    return { scrubbedAccount: false, scrubbedPiiDocs, hadActiveSubscription }
  }

  // Emit `pii_anonymized` (brief 0032 / AC-07) — PII-free: an opaque
  // `subjectRef` (the userId) + the account scope, never a name/contact.
  // Erasure is account-level (global, cross-org), so `orgId` is null.
  await emitPiiEvent('pii_anonymized', {
    orgId: null,
    subjectRef: userId,
    scope: 'account',
  })

  return { scrubbedAccount: true, scrubbedPiiDocs, hadActiveSubscription }
}

// Enumerates the orgs the subject is reachable in, WITHOUT `collectionGroup`
// (ADR 0004). Three per-user sources, unioned:
//   (a) the `org_links` reverse index (brief 0032 / #1097, AC-10) — the
//       canonical identity-layer graph of every org the subject is a CUSTOMER
//       of, written as a saga step on customer creation. This CLOSES #1101's
//       prior gap: a customer with no membership in a PAST org (no longer
//       their `currentOrgId`) is now enumerable, so the global cascade
//       reaches every org where they hold customer data;
//   (b) `memberships` (top-level, keyed by userId) — orgs where they're a
//       member/memberOperation, which the reverse index intentionally does NOT
//       cover (memberOperation is not self-erasable — brief 0041);
//   (c) the user's `currentOrgId` — a defensive fallback for the active
//       org.
// All three are per-user reads (own subcollection / userId-keyed top-level /
// own user doc) — never a cross-org query.
async function enumerateSubjectOrgs(userId: string): Promise<string[]> {
  const linkedOrgIds = await listLinkedOrgIds(userId)
  const orgIds = new Set(linkedOrgIds)

  // The subject's memberships in ANY status (active/invited/suspended/revoked) —
  // a revoked membership still means memberOperation PII to scrub. Reads the
  // subject's OWN rows under the per-subject RLS policy (`app.current_user_id`),
  // never a cross-org query (mirrors the Firestore `where userId == X`).
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

// Deletes every per-org `_pii` doc that belongs to the subject, across the
// given orgs. `units_pii` is OUT of scope (establishment, not a data
// subject). Returns the number of docs deleted.
async function scrubOrgPii(orgIds: string[], userId: string): Promise<number> {
  let deleted = 0
  for (const orgId of orgIds) {
    // member_operations_pii: keyed by the memberOperation doc id; find the subject's
    // memberOperation projections by `user_id` (under RLS), then delete each PII row.
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

    // invites_pii: keyed by the invite doc id; the subject is the invitee that
    // accepted the invite (`accepted_by_uid`). The email is the only PII.
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
