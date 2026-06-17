import { TenantLink, tenantLinkDocPath } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection — the establishment list only needs the business name.
const TenantNameProbe = Schema.Struct({ name: Schema.optional(Schema.String) })

// Reverse index writer + reader — identity-layer graph of the establishments a
// data subject is a CUSTOMER of (brief 0032 / #1097, AC-10).
//
// The index lives under the subject's OWN identity doc
// (`users/{uid}/tenant_links/{tenantId}`) and holds ONLY references (zero PII):
// the tenant id (doc id) + `linkedAt`. It is the generalization of the pattern
// ADR 0004 already adopts (`memberships` top-level) — the identity↔tenant graph
// in the identity layer — so "where am I a customer?" is a per-user read of the
// subject's own subcollection, NOT a banned cross-tenant `collectionGroup`.
//
// Writes go through the admin SDK (server-side only); Rules let the owner READ
// their own links but block all client writes.

// Records that `userId` is a customer of `tenantId`. Idempotent: the doc id is
// the tenantId, so re-linking the same pair is a no-op merge that never
// duplicates or rewrites `linkedAt`. Called as a saga step on customer creation
// (never on customer re-booking — the link already exists). NEVER carries PII.
export async function linkCustomerTenant(userId: string, tenantId: string): Promise<void> {
  if (!userId || !tenantId) return
  const db = getAdminFirestore()
  const ref = db.doc(tenantLinkDocPath(userId, tenantId))
  const existing = await ref.get()
  if (existing.exists) return
  const link: TenantLink = { tenantId, linkedAt: new Date().toISOString() }
  await ref.set(link)
}

// Lists the tenant ids the subject is a customer of, reading ONLY their own
// reverse index — a per-user read of `users/{uid}/tenant_links`, never a
// cross-tenant query (ADR 0004). Returns an empty array for a subject with no
// links (or an anonymous customer with no account).
export async function listLinkedTenantIds(userId: string): Promise<string[]> {
  if (!userId) return []
  const db = getAdminFirestore()
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('tenant_links')
    .withConverter(fsConverter(TenantLink))
    .get()
  return snap.docs.map((d) => d.data().tenantId)
}

// True when the subject's OWN reverse index records that they are a customer of
// `tenantId`. A per-user read of a single doc under `users/{uid}/tenant_links` —
// never a cross-tenant query. Guards the self-service per-establishment erasure
// against acting on a tenant the subject has no customer relationship with.
export async function isLinkedToTenant(userId: string, tenantId: string): Promise<boolean> {
  if (!userId || !tenantId) return false
  const db = getAdminFirestore()
  const snap = await db.doc(tenantLinkDocPath(userId, tenantId)).get()
  return snap.exists
}

// A discovered establishment the subject is a customer of, for the
// settings/privacy list (brief 0032 / #1097, AC-10). `name` is the establishment
// BUSINESS name (not the subject's PII) — read from the tenant doc to label the
// row the subject acts on.
export type LinkedEstablishment = {
  tenantId: string
  name: string
}

// Resolves the establishments the subject is a customer of, for display. Reads
// the subject's OWN reverse index (per-user), then each tenant doc by id (point
// reads, not a cross-tenant query) to label the row. Tenants whose doc is gone
// fall back to the id so the subject can still act on the link.
export async function listMyCustomerEstablishments(userId: string): Promise<LinkedEstablishment[]> {
  const tenantIds = await listLinkedTenantIds(userId)
  if (tenantIds.length === 0) return []
  const db = getAdminFirestore()
  const docs = await Promise.all(
    tenantIds.map((id) =>
      db.collection('tenants').doc(id).withConverter(fsConverter(TenantNameProbe)).get(),
    ),
  )
  return docs
    .map((doc, i) => {
      const tenantId = tenantIds[i]!
      const name = doc.data()?.name
      return { tenantId, name: name && name.length > 0 ? name : tenantId }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
