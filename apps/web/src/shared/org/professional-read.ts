// Server-side reads that hydrate Professional docs with identity + the
// per-org operational PII so the UI consumes a single `Professional` shape
// and does not have to know about the projection/PII split. The immutable
// event payload + projection carry NO PII (ADR 0010 — direito à eliminação /
// LGPD). Two PII sources are merged at read time:
//
//   1. Personal identity (name/whatsapp/email) — read LIVE from the global
//      `users/{userId}` doc (#1046 / brief 0028 AC-04/AC-05). This is a
//      reference, not a stored copy: editing the User reflects on the
//      professional with no re-write. The email is the verified OAuth/invite
//      email; whatsapp comes from the completion step (#838).
//   2. Professional-specific PII (`taxIdentity`) — lives in the per-org
//      deletable doc `professionals_pii/{id}`. It can diverge from personal
//      identity (e.g. MEI CNPJ) so it stays professional-scoped.
//
// LGPD per-org severability (brief 0032 / #1063): identity is a live
// reference to the global User. Per-org anonymization severs the link
// (and falls back to neutral text via `emptyEnrichment`) WITHOUT touching the
// global User — this read path tolerates a missing/severed User by design.
// Mirrors `customer-read.ts` (the reference identity-merge pattern, #832/#836).

import {
  type Professional,
  ProfessionalPii,
  StoredProfessional,
  User,
  resolveSubjectName,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { decodeAs, fsConverter } from '@/shared/db/converter'

// What we actually persist under `orgs/{t}/professionals/{id}` (the
// event projection) + the deletable PII doc at `professionals_pii/{id}`
// (`ProfessionalPii`, holding ONLY `taxIdentity` after #1046 —
// name/whatsapp/email live on the global User, read live). Both re-exported
// from `@/domain` (read-model source-of-truth) so existing importers keep
// resolving them from here.
export type { ProfessionalPii, StoredProfessional } from '@/domain'

function emptyEnrichment(p: StoredProfessional, pii: ProfessionalPii | undefined): Professional {
  // The linked User went missing (or the per-org link was severed for
  // LGPD — brief 0032). UI degrades gracefully with neutral text instead of
  // crashing; `taxIdentity` (professional-scoped) still merges if present.
  return {
    ...p,
    name: '(profissional sem dados)',
    whatsapp: '',
    email: null,
    taxIdentity: pii?.taxIdentity ?? null,
  }
}

function mergeIdentity(
  p: StoredProfessional,
  user: User | undefined,
  pii: ProfessionalPii | undefined,
): Professional {
  if (!user) return emptyEnrichment(p, pii)
  return {
    ...p,
    // Live identity reference — global User is the source of truth. Anonymized
    // accounts (LGPD #1095, AC-03) resolve to the neutral `Profissional ‹CODE›`.
    //
    // The CUSTOMER per-org block (#1096/#1100) is deliberately NOT applied
    // here: the professional/employment relationship is a DIFFERENT relationship
    // (brief 0032 re-scope 04/06). It is retained IDENTIFIABLE (legal retention,
    // art. 16); its severance is the establishment's offboarding (brief 0041 /
    // #1102), not a customer erasure. So a person blocked as a customer in this
    // org still shows their REAL name (+ avatar) on professional surfaces
    // (team, commissions report).
    name: resolveSubjectName(p.userId, user, 'Profissional') ?? '',
    whatsapp: user.whatsapp ?? '',
    email: user.email,
    // Professional-specific PII stays per-org (can diverge — MEI CNPJ).
    taxIdentity: pii?.taxIdentity ?? null,
  }
}

async function fetchPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, ProfessionalPii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const db = getAdminFirestore()
  const piiCol = db.collection('orgs').doc(orgId).collection('professionals_pii')
  const refs = unique.map((id) => piiCol.doc(id))
  const snaps = await db.getAll(...refs)
  return new Map(
    snaps.flatMap((s) => {
      const raw = s.data()
      const v = raw ? decodeAs(ProfessionalPii, raw) : undefined
      return v ? [[s.id, v] as const] : []
    }),
  )
}

async function fetchUsersByIds(uids: readonly string[]): Promise<Map<string, User>> {
  const unique = [...new Set(uids.filter((uid) => Boolean(uid)))]
  if (unique.length === 0) return new Map()
  const db = getAdminFirestore()
  const refs = unique.map((uid) => db.collection('users').doc(uid))
  const snaps = await db.getAll(...refs)
  return new Map(
    snaps.flatMap((s) => {
      const raw = s.data()
      const v = raw ? decodeAs(User, raw) : undefined
      return v ? [[s.id, v] as const] : []
    }),
  )
}

// Hydrate a batch of Professional docs: identity from `users/` (live) +
// `taxIdentity` from `professionals_pii/`, in two batched round-trips. Order
// is preserved.
export async function enrichProfessionals(
  orgId: string,
  professionals: readonly StoredProfessional[],
): Promise<Professional[]> {
  if (professionals.length === 0) return []
  const [pii, users] = await Promise.all([
    fetchPiiByIds(
      orgId,
      professionals.map((p) => p.id),
    ),
    fetchUsersByIds(professionals.map((p) => p.userId)),
  ])
  return professionals.map((p) => mergeIdentity(p, users.get(p.userId), pii.get(p.id)))
}

// List all professionals for a org, enriched with PII and sorted by name
// in JS (the `name` field no longer lives on the Firestore doc, so the old
// `orderBy('name')` query is gone — sort happens after enrich).
export async function listProfessionalsForOrg(orgId: string): Promise<Professional[]> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const stored = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
  const enriched = await enrichProfessionals(orgId, stored)
  return enriched.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

export async function getProfessionalById(
  orgId: string,
  professionalId: string,
): Promise<Professional | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .doc(professionalId)
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const data = snap.data()
  const stored = data ? { ...data, id: snap.id } : undefined
  if (!stored) return null
  const [enriched] = await enrichProfessionals(orgId, [stored])
  return enriched ?? null
}

// Resolve the operational Professional projection for a member by their
// `userId` (brief 0037 #1085). A Professional is the projection of a
// `Membership(role=professional)` + `User`, born from the invite saga with a
// non-null `userId` (brief 0028 #1045) — so the member detail looks the
// projection up by the membership's `userId`, not by the projection id (which
// is random). Returns null when no projection exists yet (e.g. a member just
// promoted to professional before role-edit lifecycle materializes it, #1086).
export async function getProfessionalByUserId(
  orgId: string,
  userId: string,
): Promise<Professional | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .where('userId', '==', userId)
    .limit(1)
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const doc = snap.docs[0]
  if (!doc) return null
  const stored = { ...doc.data(), id: doc.id }
  const [enriched] = await enrichProfessionals(orgId, [stored])
  return enriched ?? null
}

// Write the per-org PII doc directly (mutable, deletable, NOT
// event-sourced). After #1046 it holds only `taxIdentity` — personal identity
// is a live reference to the global User. Called from the update action
// alongside the domain event emission.
export async function writeProfessionalPii(
  orgId: string,
  professionalId: string,
  pii: ProfessionalPii,
): Promise<void> {
  await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('professionals_pii')
    .doc(professionalId)
    .set(pii)
}

// Delete the PII doc (LGPD erasure) — called when the professional is deleted.
export async function deleteProfessionalPii(orgId: string, professionalId: string): Promise<void> {
  await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('professionals_pii')
    .doc(professionalId)
    .delete()
}
