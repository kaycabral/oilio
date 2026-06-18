import { OrgLink, orgLinkDocPath } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection — the establishment list only needs the business name.
const OrgNameProbe = Schema.Struct({ name: Schema.optional(Schema.String) })

// Reverse index writer + reader — identity-layer graph of the establishments a
// data subject is a CUSTOMER of (brief 0032 / #1097, AC-10).
//
// The index lives under the subject's OWN identity doc
// (`users/{uid}/org_links/{orgId}`) and holds ONLY references (zero PII):
// the org id (doc id) + `linkedAt`. It is the generalization of the pattern
// ADR 0004 already adopts (`memberships` top-level) — the identity↔org graph
// in the identity layer — so "where am I a customer?" is a per-user read of the
// subject's own subcollection, NOT a banned cross-org `collectionGroup`.
//
// Writes go through the admin SDK (server-side only); Rules let the owner READ
// their own links but block all client writes.

// Records that `userId` is a customer of `orgId`. Idempotent: the doc id is
// the orgId, so re-linking the same pair is a no-op merge that never
// duplicates or rewrites `linkedAt`. Called as a saga step on customer creation
// (never on customer re-booking — the link already exists). NEVER carries PII.
export async function linkCustomerOrg(userId: string, orgId: string): Promise<void> {
  if (!userId || !orgId) return
  const db = getAdminFirestore()
  const ref = db.doc(orgLinkDocPath(userId, orgId))
  const existing = await ref.get()
  if (existing.exists) return
  const link: OrgLink = { orgId, linkedAt: new Date().toISOString() }
  await ref.set(link)
}

// Lists the org ids the subject is a customer of, reading ONLY their own
// reverse index — a per-user read of `users/{uid}/org_links`, never a
// cross-org query (ADR 0004). Returns an empty array for a subject with no
// links (or an anonymous customer with no account).
export async function listLinkedOrgIds(userId: string): Promise<string[]> {
  if (!userId) return []
  const db = getAdminFirestore()
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('org_links')
    .withConverter(fsConverter(OrgLink))
    .get()
  return snap.docs.map((d) => d.data().orgId)
}

// True when the subject's OWN reverse index records that they are a customer of
// `orgId`. A per-user read of a single doc under `users/{uid}/org_links` —
// never a cross-org query. Guards the self-service per-establishment erasure
// against acting on a org the subject has no customer relationship with.
export async function isLinkedToOrg(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false
  const db = getAdminFirestore()
  const snap = await db.doc(orgLinkDocPath(userId, orgId)).get()
  return snap.exists
}

// A discovered establishment the subject is a customer of, for the
// settings/privacy list (brief 0032 / #1097, AC-10). `name` is the establishment
// BUSINESS name (not the subject's PII) — read from the org doc to label the
// row the subject acts on.
export type LinkedEstablishment = {
  orgId: string
  name: string
}

// Resolves the establishments the subject is a customer of, for display. Reads
// the subject's OWN reverse index (per-user), then each org doc by id (point
// reads, not a cross-org query) to label the row. Orgs whose doc is gone
// fall back to the id so the subject can still act on the link.
export async function listMyCustomerEstablishments(userId: string): Promise<LinkedEstablishment[]> {
  const orgIds = await listLinkedOrgIds(userId)
  if (orgIds.length === 0) return []
  const db = getAdminFirestore()
  const docs = await Promise.all(
    orgIds.map((id) =>
      db.collection('orgs').doc(id).withConverter(fsConverter(OrgNameProbe)).get(),
    ),
  )
  return docs
    .map((doc, i) => {
      const orgId = orgIds[i]!
      const name = doc.data()?.name
      return { orgId, name: name && name.length > 0 ? name : orgId }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
