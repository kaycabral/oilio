import { buildUserAnonymizationScrub, Membership } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listLinkedTenantIds } from '@/shared/identity/tenant-links'
import { eraseCustomerCascadeInTenant } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'
import { deleteInvitePii } from '@/shared/tenant/invite-read'
import { deleteProfessionalPii } from '@/shared/tenant/professional-read'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection of the user doc — only `currentTenantId` is read here.
const UserCurrentTenantDoc = Schema.Struct({
  currentTenantId: Schema.optional(Schema.NullOr(Schema.String)),
})

// Account-level (global) PII anonymization — brief 0032 / #1093 (AC-01/02/04).
//
// The person's name lived ONLY in the global `users/{uid}` doc (a plain CRUD
// doc, NOT event-sourced). Anonymizing = a direct, irreversible scrub of that
// doc plus the subject's deletable per-tenant `_pii` docs. Records
// (orders/commissions/memberships/professionals/invites) keep their `userId`
// pointer untouched (AC-04 retention); they resolve to a neutral label because
// the account is anonymized (display handled by #1095). There is no reverse
// map (art. 12) and no per-record sever / anonymization event (that was the
// per-tenant model, deferred — AC-08).

export type AnonymizeAccountResult = {
  // Whether the global account doc was scrubbed (false only for an anonymous
  // customer with no `users/{uid}` — the `userId` was null/empty: no-op).
  scrubbedAccount: boolean
  // Count of per-tenant `_pii` docs deleted (professionals_pii + invites_pii).
  scrubbedPiiDocs: number
  // Whether the subject had an active subscription (in any enumerated tenant)
  // that the erasure cascade cancelled (brief 0032 / #1101, AC-12). Surfaced for
  // the informed-consent fact.
  hadActiveSubscription: boolean
}

// Irreversibly anonymizes the global account `userId` and scrubs the subject's
// per-tenant `_pii` docs. An anonymous customer (`userId` null/'') is a no-op.
// Idempotent: re-running over an already-anonymized account re-applies the
// neutral scrub (no PII is ever reconstructed).
export async function anonymizeAccount(userId: string): Promise<AnonymizeAccountResult> {
  // Anonymous customer (walk-in with no platform account) — nothing to scrub.
  if (!userId) return { scrubbedAccount: false, scrubbedPiiDocs: 0, hadActiveSubscription: false }

  const db = getAdminFirestore()
  const now = new Date().toISOString()

  // Enumerate the subject's tenants WITHOUT a cross-tenant query (ADR 0004).
  const tenantIds = await enumerateSubjectTenants(userId)

  // 1. Erasure cascade (brief 0032 / #1101): across the subject's enumerated
  //    tenants, cancel each active subscription immediately (+ stop its pending
  //    charges) and cancel their future appointments. Saga + idempotent + errors
  //    surface (AC-12 / AC-14).
  let hadActiveSubscription = false
  for (const tenantId of tenantIds) {
    const cascade = await eraseCustomerCascadeInTenant(tenantId, userId)
    if (cascade.hadActiveSubscription) hadActiveSubscription = true
  }

  // 2. Scrub the per-tenant `_pii` docs. Within each tenant: professionals_pii
  //    (matched by `professionals.userId`) and invites_pii (by `acceptedByUid`).
  const scrubbedPiiDocs = await scrubTenantPii(tenantIds, userId)

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
  // Erasure is account-level (global, cross-tenant), so `tenantId` is null.
  await emitPiiEvent('pii_anonymized', {
    tenantId: null,
    subjectRef: userId,
    scope: 'account',
  })

  return { scrubbedAccount: true, scrubbedPiiDocs, hadActiveSubscription }
}

// Enumerates the tenants the subject is reachable in, WITHOUT `collectionGroup`
// (ADR 0004). Three per-user sources, unioned:
//   (a) the `tenant_links` reverse index (brief 0032 / #1097, AC-10) — the
//       canonical identity-layer graph of every tenant the subject is a CUSTOMER
//       of, written as a saga step on customer creation. This CLOSES #1101's
//       prior gap: a customer with no membership in a PAST tenant (no longer
//       their `currentTenantId`) is now enumerable, so the global cascade
//       reaches every tenant where they hold customer data;
//   (b) `memberships` (top-level, keyed by userId) — tenants where they're a
//       member/professional, which the reverse index intentionally does NOT
//       cover (professional is not self-erasable — brief 0041);
//   (c) the user's `currentTenantId` — a defensive fallback for the active
//       tenant.
// All three are per-user reads (own subcollection / userId-keyed top-level /
// own user doc) — never a cross-tenant query.
async function enumerateSubjectTenants(userId: string): Promise<string[]> {
  const db = getAdminFirestore()

  const linkedTenantIds = await listLinkedTenantIds(userId)
  const tenantIds = new Set(linkedTenantIds)

  const memberships = await db
    .collection('memberships')
    .withConverter(fsConverter(Membership))
    .where('userId', '==', userId)
    .get()
  for (const m of memberships.docs.map((d) => d.data())) tenantIds.add(m.tenantId)

  const userSnap = await db
    .collection('users')
    .doc(userId)
    .withConverter(fsConverter(UserCurrentTenantDoc))
    .get()
  const currentTenantId = userSnap.data()?.currentTenantId
  if (currentTenantId) tenantIds.add(currentTenantId)

  return [...tenantIds]
}

// Deletes every per-tenant `_pii` doc that belongs to the subject, across the
// given tenants. `units_pii` is OUT of scope (establishment, not a data
// subject). Returns the number of docs deleted.
async function scrubTenantPii(tenantIds: string[], userId: string): Promise<number> {
  const db = getAdminFirestore()

  let deleted = 0
  for (const tenantId of tenantIds) {
    // professionals_pii: keyed by the professional doc id; find the subject's
    // professional projections by `userId`, then delete each PII doc.
    const proSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('professionals')
      .where('userId', '==', userId)
      .get()
    for (const pro of proSnap.docs) {
      await deleteProfessionalPii(tenantId, pro.id)
      deleted += 1
    }

    // invites_pii: keyed by the invite doc id; the subject is the invitee that
    // accepted the invite (`acceptedByUid`). The email is the only PII.
    const inviteSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('invites')
      .where('acceptedByUid', '==', userId)
      .get()
    for (const inv of inviteSnap.docs) {
      await deleteInvitePii(tenantId, inv.id)
      deleted += 1
    }
  }

  return deleted
}
