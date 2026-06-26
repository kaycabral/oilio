import { TaxIdentity as TaxIdentitySchema, type TaxIdentity, type UnitPii } from '@/domain'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { getEventStorePool } from './pool'
import { readUnderRls } from './rls-read'

const decodeTaxIdentity = Schema.decodeUnknownSync(Schema.NullOr(TaxIdentitySchema))

/**
 * CRUD helpers for the deletable unit PII sidecars `units_pii` (contact PII:
 * whatsapp/email) and `unit_tax_identity` (fiscal PII: the name-bearing
 * legalName/tradeName of a formalized unit) — migration feature F (cutover,
 * brief 0062). Both are org-scoped (org RLS), so reads go through
 * `readUnderRls(orgId, …)` and writes set `app.current_org` inside their
 * transaction. The sidecar holds the PII the typed `units` projection omits;
 * deleting a row erases the PII while the projection + event history stay intact
 * (ADR 0010 / LGPD).
 */

function unitsPiiPath(orgId: string, id: string): string {
  return `orgs/${orgId}/units_pii/${id}`
}

function unitTaxIdentityPath(orgId: string, unitId: string): string {
  return `orgs/${orgId}/units/${unitId}/private/taxIdentity`
}

// ── units_pii (contact PII) ────────────────────────────────────────────────

export async function getUnitsPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, UnitPii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const paths = unique.map((id) => unitsPiiPath(orgId, id))
  const rows = await readUnderRls<{ id: string; whatsapp: string; email: string | null }>(
    orgId,
    (client) =>
      client
        .query<{
          id: string
          whatsapp: string
          email: string | null
        }>('SELECT id, whatsapp, email FROM units_pii WHERE aggregate_path = ANY($1)', [paths])
        .then((res) => res.rows),
  )
  return new Map(rows.map((r) => [r.id, { whatsapp: r.whatsapp, email: r.email }] as const))
}

export async function upsertUnitsPii(orgId: string, unitId: string, pii: UnitPii): Promise<void> {
  await writeUnderOrg(orgId, (client) =>
    client.query(
      `INSERT INTO units_pii (aggregate_path, org_id, id, whatsapp, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (aggregate_path) DO UPDATE SET whatsapp = EXCLUDED.whatsapp, email = EXCLUDED.email`,
      [unitsPiiPath(orgId, unitId), orgId, unitId, pii.whatsapp, pii.email],
    ),
  )
}

export async function deleteUnitsPii(orgId: string, unitId: string): Promise<void> {
  await writeUnderOrg(orgId, (client) =>
    client.query('DELETE FROM units_pii WHERE aggregate_path = $1', [unitsPiiPath(orgId, unitId)]),
  )
}

// ── unit_tax_identity (fiscal PII) ───────────────────────────────────────────

export async function getUnitTaxIdentityById(
  orgId: string,
  unitId: string,
): Promise<TaxIdentity | null> {
  const rows = await readUnderRls<{ tax_identity: unknown }>(orgId, (client) =>
    client
      .query<{
        tax_identity: unknown
      }>('SELECT tax_identity FROM unit_tax_identity WHERE aggregate_path = $1', [
        unitTaxIdentityPath(orgId, unitId),
      ])
      .then((res) => res.rows),
  )
  return decodeTaxIdentity(rows[0]?.tax_identity ?? null)
}

export async function upsertUnitTaxIdentity(
  orgId: string,
  unitId: string,
  taxIdentity: TaxIdentity | null,
): Promise<void> {
  await writeUnderOrg(orgId, (client) =>
    client.query(
      `INSERT INTO unit_tax_identity (aggregate_path, org_id, id, tax_identity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (aggregate_path) DO UPDATE SET tax_identity = EXCLUDED.tax_identity`,
      [
        unitTaxIdentityPath(orgId, unitId),
        orgId,
        unitId,
        taxIdentity === null ? null : JSON.stringify(taxIdentity),
      ],
    ),
  )
}

export async function deleteUnitTaxIdentity(orgId: string, unitId: string): Promise<void> {
  await writeUnderOrg(orgId, (client) =>
    client.query('DELETE FROM unit_tax_identity WHERE aggregate_path = $1', [
      unitTaxIdentityPath(orgId, unitId),
    ]),
  )
}

// Run a write under the org RLS GUC (org-scoped sidecars). Sets `app.current_org`
// inside the tx so the policy WITH CHECK admits the write.
async function writeUnderOrg(
  orgId: string,
  fn: (client: PoolClient) => Promise<unknown>,
): Promise<void> {
  const client = await getEventStorePool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org', orgId])
    await fn(client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
