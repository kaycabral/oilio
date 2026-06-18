import { buildUserAnonymizationScrub, Membership } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { deleteInvitePii } from '@/shared/org/invite-read'
import { deleteProfessionalPii } from '@/shared/org/professional-read'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection of the user doc — only `currentOrgId` is read here.
const UserCurrentOrgDoc = Schema.Struct({
  currentOrgId: Schema.optional(Schema.NullOr(Schema.String)),
})

// Account-level (global) PII anonymization — brief 0032 / #1093 (AC-01/02/04).
//
// The person's name lived ONLY in the global `users/{uid}` doc (a plain CRUD
// doc, NOT event-sourced). Anonymizing = a direct, irreversible scrub of that
// doc plus the subject's deletable per-org `_pii` docs. Records
// (orders/commissions/memberships/professionals/invites) keep their `userId`
// pointer untouched (AC-04 retention); they resolve to a neutral label because
// the account is anonymized (display handled by #1095). There is no reverse
// map (art. 12) and no per-record sever / anonymization event (that was the
// per-org model, deferred — AC-08).

export type AnonymizeAccountResult = {
  // Whether the global account doc was scrubbed (false only for an anonymous
  // customer with no `users/{uid}` — the `userId` was null/empty: no-op).
  scrubbedAccount: boolean
  // Count of per-org `_pii` docs deleted (professionals_pii + invites_pii).
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

  const db = getAdminFirestore()
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

  // 2. Scrub the per-org `_pii` docs. Within each org: professionals_pii
  //    (matched by `professionals.userId`) and invites_pii (by `acceptedByUid`).
  const scrubbedPiiDocs = await scrubOrgPii(orgIds, userId)

  // 3. Scrub the global account doc — the single place the name existed. If the
  //    user doc is gone (deleted stub), there's nothing left to anonymize.
  const userRef = db.collection('users').doc(userId)
  const userSnap = await userRef.get()
  if (!userSnap.exists) {
    return { scrubbedAccount: false, scrubbedPiiDocs, hadActiveSubscription }
  }
  await userRef.update({ ...buildUserAnonymizationScrub(now) })

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
//       member/professional, which the reverse index intentionally does NOT
//       cover (professional is not self-erasable — brief 0041);
//   (c) the user's `currentOrgId` — a defensive fallback for the active
//       org.
// All three are per-user reads (own subcollection / userId-keyed top-level /
// own user doc) — never a cross-org query.
async function enumerateSubjectOrgs(userId: string): Promise<string[]> {
  const db = getAdminFirestore()

  const linkedOrgIds = await listLinkedOrgIds(userId)
  const orgIds = new Set(linkedOrgIds)

  const memberships = await db
    .collection('memberships')
    .withConverter(fsConverter(Membership))
    .where('userId', '==', userId)
    .get()
  for (const m of memberships.docs.map((d) => d.data())) orgIds.add(m.orgId)

  const userSnap = await db
    .collection('users')
    .doc(userId)
    .withConverter(fsConverter(UserCurrentOrgDoc))
    .get()
  const currentOrgId = userSnap.data()?.currentOrgId
  if (currentOrgId) orgIds.add(currentOrgId)

  return [...orgIds]
}

// Deletes every per-org `_pii` doc that belongs to the subject, across the
// given orgs. `units_pii` is OUT of scope (establishment, not a data
// subject). Returns the number of docs deleted.
async function scrubOrgPii(orgIds: string[], userId: string): Promise<number> {
  const db = getAdminFirestore()

  let deleted = 0
  for (const orgId of orgIds) {
    // professionals_pii: keyed by the professional doc id; find the subject's
    // professional projections by `userId`, then delete each PII doc.
    const proSnap = await db
      .collection('orgs')
      .doc(orgId)
      .collection('professionals')
      .where('userId', '==', userId)
      .get()
    for (const pro of proSnap.docs) {
      await deleteProfessionalPii(orgId, pro.id)
      deleted += 1
    }

    // invites_pii: keyed by the invite doc id; the subject is the invitee that
    // accepted the invite (`acceptedByUid`). The email is the only PII.
    const inviteSnap = await db
      .collection('orgs')
      .doc(orgId)
      .collection('invites')
      .where('acceptedByUid', '==', userId)
      .get()
    for (const inv of inviteSnap.docs) {
      await deleteInvitePii(orgId, inv.id)
      deleted += 1
    }
  }

  return deleted
}
