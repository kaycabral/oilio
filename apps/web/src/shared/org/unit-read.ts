// Server-side reads that hydrate Unit docs with PII (whatsapp/email) from the
// per-org `units_pii/{id}` collection so callers consume a single `Unit`
// shape. Mirrors `customer-read.ts`/`professional-read.ts` (the reference LGPD
// pattern): the immutable event payload + projection carry NO PII; PII lives
// in a separate mutable/deletable doc and is merged at read time. See #1036 +
// ADR 0010 (PII fora de evento — direito à eliminação / LGPD).
//
// `name`/`slug`/`address`/`agenda`/`timezone` are NOT PII and stay on the unit
// doc — only the contact channels move out.

import { StoredUnit, type TaxIdentity, type Unit, type UnitPii } from '@/domain'
import { rowToDoc, type UnitRow } from '@/shared/db/pg/effect/unit-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import {
  deleteUnitsPii,
  getUnitsPiiByIds,
  getUnitTaxIdentityById,
  upsertUnitsPii,
  upsertUnitTaxIdentity,
} from '@/shared/db/pg/units-pii-store'
import { Schema } from 'effect'

const decodeStoredUnit = Schema.decodeUnknownSync(StoredUnit)

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

// Hydrate a batch of Unit docs in one round-trip to the PII sidecar.
// Order is preserved.
export async function enrichUnits(orgId: string, units: readonly StoredUnit[]): Promise<Unit[]> {
  if (units.length === 0) return []
  const pii = await getUnitsPiiByIds(
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
  const rows = await readUnderRls<UnitRow>(orgId, (client) =>
    client
      .query<UnitRow>('SELECT * FROM units WHERE org_id = $1 ORDER BY name', [orgId])
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredUnit(rowToDoc(r))).filter((u) => !u.archivedAt)
  return enrichUnits(orgId, stored)
}

// All units of an org as the non-PII `StoredUnit` (no `units_pii` merge),
// ordered by name, INCLUDING archived units. For PUBLIC surfaces (self-book
// availability) that must NOT leak the unit's contact PII (whatsapp/email) and
// resolve the bookable unit themselves via `isUnitBookable`. The PII-enriched
// `Unit` is for operator surfaces — use `listUnitsForOrg` there.
export async function listStoredUnitsForOrg(orgId: string): Promise<StoredUnit[]> {
  const rows = await readUnderRls<UnitRow>(orgId, (client) =>
    client
      .query<UnitRow>('SELECT * FROM units WHERE org_id = $1 ORDER BY name', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeStoredUnit(rowToDoc(r)))
}

export async function getUnitById(orgId: string, unitId: string): Promise<Unit | null> {
  const rows = await readUnderRls<UnitRow>(orgId, (client) =>
    client
      .query<UnitRow>('SELECT * FROM units WHERE org_id = $1 AND id = $2', [orgId, unitId])
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichUnits(orgId, [decodeStoredUnit(rowToDoc(row))])
  return enriched ?? null
}

// All `{id, slug}` pairs for an org's units, backend-aware — the slug-uniqueness
// check on unit create/edit. Includes ARCHIVED units (an archived unit's slug
// still occupies the per-org public namespace, so it must still collide). No PII
// merge (slug is not PII). Reads the typed table under RLS.
export async function listUnitSlugs(orgId: string): Promise<{ id: string; slug: string }[]> {
  const rows = await readUnderRls<{ id: string; slug: string }>(orgId, (client) =>
    client
      .query<{
        id: string
        slug: string
      }>('SELECT id, slug FROM units WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => ({ id: r.id, slug: r.slug }))
}

// All unit ids for an org — the catalog-item form's unit-membership check
// (defense in depth: every submitted `unitIds` must reference a real unit).
// Includes ARCHIVED units (an item can still be offered at a retired unit's
// historical reference; mirrors the Firestore `.collection('units').get()` which
// returned every unit). No PII merge. Reads the typed table under RLS.
export async function listUnitIds(orgId: string): Promise<string[]> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{ id: string }>('SELECT id FROM units WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.id)
}

// Write the PII sidecar directly (mutable, deletable, NOT event-sourced). Called
// from create/update actions alongside the domain event emission.
export async function writeUnitPii(orgId: string, unitId: string, pii: UnitPii): Promise<void> {
  await upsertUnitsPii(orgId, unitId, pii)
}

// Delete the PII sidecar (LGPD erasure) — called when the unit is deleted.
export async function deleteUnitPii(orgId: string, unitId: string): Promise<void> {
  await deleteUnitsPii(orgId, unitId)
}

// --- Unit fiscal PII (razão social / nome fantasia) ------------------------
//
// The name-bearing fiscal fields of a FORMALIZED unit (brief 0048 AC-03):
// `legalName` / `tradeName`. A MEI's razão social embeds the owner's civil name,
// so these are PII and live in the deletable per-unit doc
// `orgs/{orgId}/units/{unitId}/private/taxIdentity`, NEVER in the
// `unit.formalized` event (ADR 0010). The non-PII fiscal union
// (`Unit.fiscal` = CNPJ-14 + CompanyProfile) stays on the unit doc. QSA/sócios
// are NOT stored. Mirrors the Org's `private/taxIdentity` pattern.

export async function getUnitTaxIdentity(
  orgId: string,
  unitId: string,
): Promise<TaxIdentity | null> {
  return getUnitTaxIdentityById(orgId, unitId)
}

// Write the deletable unit fiscal-PII sidecar directly (mutable, NOT
// event-sourced). Called from the formalize action alongside the
// `unit.formalized` emission.
export async function writeUnitTaxIdentity(
  orgId: string,
  unitId: string,
  taxIdentity: TaxIdentity | null,
): Promise<void> {
  await upsertUnitTaxIdentity(orgId, unitId, taxIdentity)
}
