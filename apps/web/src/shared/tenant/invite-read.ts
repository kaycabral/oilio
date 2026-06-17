// Server-side reads that hydrate Invite docs with the invitee email from the
// per-tenant `invites_pii/{id}` collection. Mirrors `customer-read.ts` (the
// reference LGPD pattern): the immutable event payload + projection carry NO
// PII; the email lives in a separate mutable/deletable doc and is merged at
// read time. See #1036 + ADR 0010 (PII fora de evento — direito à
// eliminação / LGPD).

import { type Invite, InvitePii, StoredInvite } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { decodeAs, fsConverter } from '@/shared/db/converter'

// What we actually persist under `tenants/{t}/invites/{id}` (the event
// projection) + the deletable PII doc at `invites_pii/{id}` (`InvitePii`,
// holding `email`). Both re-exported from `@/domain` (read-model
// source-of-truth) so existing importers (`team.actions`, `offboard-member`)
// keep resolving them from here.
export type { InvitePii, StoredInvite } from '@/domain'

function mergeWithPii(i: StoredInvite, pii: InvitePii | undefined): Invite {
  return { ...i, email: pii?.email ?? '' }
}

async function fetchPiiByIds(
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, InvitePii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const db = getAdminFirestore()
  const piiCol = db.collection('tenants').doc(tenantId).collection('invites_pii')
  const refs = unique.map((id) => piiCol.doc(id))
  const snaps = await db.getAll(...refs)
  return new Map(
    snaps.flatMap((s) => {
      const raw = s.data()
      const pii = raw ? decodeAs(InvitePii, raw) : undefined
      return pii ? [[s.id, pii] as const] : []
    }),
  )
}

// Hydrate a batch of Invite docs in one round-trip to the PII collection.
// Order is preserved.
export async function enrichInvites(
  tenantId: string,
  invites: readonly StoredInvite[],
): Promise<Invite[]> {
  if (invites.length === 0) return []
  const pii = await fetchPiiByIds(
    tenantId,
    invites.map((i) => i.id),
  )
  return invites.map((i) => mergeWithPii(i, pii.get(i.id)))
}

// List all invites for a tenant, enriched with the invitee email.
export async function listInvitesForTenant(tenantId: string): Promise<Invite[]> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('invites')
    .withConverter(fsConverter(StoredInvite))
    .get()
  const stored = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
  return enrichInvites(tenantId, stored)
}

export async function getInviteById(tenantId: string, inviteId: string): Promise<Invite | null> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('invites')
    .doc(inviteId)
    .withConverter(fsConverter(StoredInvite))
    .get()
  const data = snap.data()
  const stored = data ? { ...data, id: snap.id } : undefined
  if (!stored) return null
  const [enriched] = await enrichInvites(tenantId, [stored])
  return enriched ?? null
}

// Write the PII doc directly (mutable, deletable, NOT event-sourced). Called
// from the create-invite action alongside the domain event emission.
export async function writeInvitePii(
  tenantId: string,
  inviteId: string,
  pii: InvitePii,
): Promise<void> {
  await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('invites_pii')
    .doc(inviteId)
    .set(pii)
}

// Delete the PII doc (LGPD erasure) — the invitee email is the only PII it
// holds and it is deletable / not replayed. Used by the account anonymization
// flow (brief 0032 / #1093) to scrub the subject's invite emails.
export async function deleteInvitePii(tenantId: string, inviteId: string): Promise<void> {
  await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('invites_pii')
    .doc(inviteId)
    .delete()
}
