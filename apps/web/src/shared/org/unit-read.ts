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

export type { StoredUnit, UnitPii } from '@/domain'

function mergeWithPii(u: StoredUnit, pii: UnitPii | undefined): Unit {
  return {
    ...u,
    mobile: pii?.mobile ?? '',
    email: pii?.email ?? null,
  }
}

export async function enrichUnits(orgId: string, units: readonly StoredUnit[]): Promise<Unit[]> {
  if (units.length === 0) return []
  const pii = await getUnitsPiiByIds(
    orgId,
    units.map((u) => u.id),
  )
  return units.map((u) => mergeWithPii(u, pii.get(u.id)))
}

export async function listUnitsForOrg(orgId: string): Promise<Unit[]> {
  const rows = await readUnderRls<UnitRow>(orgId, (client) =>
    client
      .query<UnitRow>('SELECT * FROM units WHERE org_id = $1 ORDER BY name', [orgId])
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredUnit(rowToDoc(r))).filter((u) => !u.archivedAt)
  return enrichUnits(orgId, stored)
}

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

export async function listUnitIds(orgId: string): Promise<string[]> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{ id: string }>('SELECT id FROM units WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.id)
}

export async function listUnitTimezones(
  orgId: string,
): Promise<{ id: string; timezone: string }[]> {
  const rows = await readUnderRls<{ id: string; timezone: string }>(orgId, (client) =>
    client
      .query<{
        id: string
        timezone: string
      }>('SELECT id, timezone FROM units WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => ({ id: r.id, timezone: r.timezone }))
}

export async function getUnitTimezone(orgId: string, unitId: string): Promise<string | null> {
  const rows = await readUnderRls<{ timezone: string }>(orgId, (client) =>
    client
      .query<{
        timezone: string
      }>('SELECT timezone FROM units WHERE org_id = $1 AND id = $2', [orgId, unitId])
      .then((res) => res.rows),
  )
  return rows[0]?.timezone ?? null
}

export async function writeUnitPii(orgId: string, unitId: string, pii: UnitPii): Promise<void> {
  await upsertUnitsPii(orgId, unitId, pii)
}

export async function deleteUnitPii(orgId: string, unitId: string): Promise<void> {
  await deleteUnitsPii(orgId, unitId)
}

export async function getUnitTaxIdentity(
  orgId: string,
  unitId: string,
): Promise<TaxIdentity | null> {
  return getUnitTaxIdentityById(orgId, unitId)
}

export async function writeUnitTaxIdentity(
  orgId: string,
  unitId: string,
  taxIdentity: TaxIdentity | null,
): Promise<void> {
  await upsertUnitTaxIdentity(orgId, unitId, taxIdentity)
}
