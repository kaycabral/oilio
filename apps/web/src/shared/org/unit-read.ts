// Server-side reads that hydrate Unit docs with PII (whatsapp/email) from the
// per-org `units_pii/{id}` collection so callers consume a single `Unit`
// shape. Mirrors `customer-read.ts`/`professional-read.ts` (the reference LGPD
// pattern): the immutable event payload + projection carry NO PII; PII lives
// in a separate mutable/deletable doc and is merged at read time. See #1036 +
// ADR 0010 (PII fora de evento — direito à eliminação / LGPD).
//
// `name`/`slug`/`address`/`businessHours` are NOT PII and stay on the unit doc
// — only the contact channels move out.

import { StoredUnit, UnitPii, type Unit } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { decodeAs, fsConverter } from '@/shared/db/converter'

// What we actually persist under `orgs/{t}/units/{id}` (the event
// projection) + the deletable PII doc at `units_pii/{id}` (`UnitPii`).
// Both re-exported from `@/domain` (read-model source-of-truth) so existing
// importers (`units.actions`, seed) keep resolving them from here.
export type { StoredUnit, UnitPii } from '@/domain'

function mergeWithPii(u: StoredUnit, pii: UnitPii | undefined): Unit {
  return {
    ...u,
    whatsapp: pii?.whatsapp ?? '',
    email: pii?.email ?? null,
  }
}

async function fetchPiiByIds(orgId: string, ids: readonly string[]): Promise<Map<string, UnitPii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const db = getAdminFirestore()
  const piiCol = db.collection('orgs').doc(orgId).collection('units_pii')
  const refs = unique.map((id) => piiCol.doc(id))
  const snaps = await db.getAll(...refs)
  return new Map(
    snaps.flatMap((s) => {
      const raw = s.data()
      const v = raw ? decodeAs(UnitPii, raw) : undefined
      return v ? [[s.id, v] as const] : []
    }),
  )
}

// Hydrate a batch of Unit docs in one round-trip to the PII collection.
// Order is preserved.
export async function enrichUnits(orgId: string, units: readonly StoredUnit[]): Promise<Unit[]> {
  if (units.length === 0) return []
  const pii = await fetchPiiByIds(
    orgId,
    units.map((u) => u.id),
  )
  return units.map((u) => mergeWithPii(u, pii.get(u.id)))
}

// List active units for a org, ordered by name (still a doc field),
// enriched with PII. Archived units (brief 0027, AC-06 — `archivedAt` set)
// drop out of the active list/pickers; they stay resolvable via `getUnitById`
// for historical references. Filtered in-memory (truthy `archivedAt`) so
// legacy docs without the field (= `undefined`) still surface.
export async function listUnitsForOrg(orgId: string): Promise<Unit[]> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('units')
    .orderBy('name')
    .withConverter(fsConverter(StoredUnit))
    .get()
  const stored = snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((u) => !u.archivedAt)
  return enrichUnits(orgId, stored)
}

export async function getUnitById(orgId: string, unitId: string): Promise<Unit | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('units')
    .doc(unitId)
    .withConverter(fsConverter(StoredUnit))
    .get()
  const data = snap.data()
  const stored = data ? { ...data, id: snap.id } : undefined
  if (!stored) return null
  const [enriched] = await enrichUnits(orgId, [stored])
  return enriched ?? null
}

// Write the PII doc directly (mutable, deletable, NOT event-sourced). Called
// from create/update actions alongside the domain event emission.
export async function writeUnitPii(orgId: string, unitId: string, pii: UnitPii): Promise<void> {
  await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('units_pii')
    .doc(unitId)
    .set(pii)
}

// Delete the PII doc (LGPD erasure) — called when the unit is deleted.
export async function deleteUnitPii(orgId: string, unitId: string): Promise<void> {
  await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('units_pii')
    .doc(unitId)
    .delete()
}
