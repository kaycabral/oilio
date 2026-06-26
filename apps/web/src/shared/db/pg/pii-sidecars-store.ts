import type { InvitePii, ProfessionalPii } from '@/domain'
import { TaxIdentity } from '@/domain'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { getEventStorePool } from './pool'
import { readUnderRls } from './rls-read'

// Strict-decode the jsonb `tax_identity` column into the domain union (repo
// convention: decode reads, never cast). Null = no PII on file.
const decodeTaxIdentity = Schema.decodeUnknownSync(Schema.NullOr(TaxIdentity))

/**
 * CRUD helpers for the deletable PII sidecars `invites_pii` / `professionals_pii`
 * (migration feature F — cutover, brief 0062). Both are org-scoped (org RLS), so
 * reads go through `readUnderRls(orgId, …)` and writes set `app.current_org`
 * inside their transaction. The sidecar holds the PII the typed projection omits
 * (invite `email`, professional `taxIdentity`); deleting a row erases the PII
 * while the projection + event history stay intact (ADR 0010 / LGPD).
 */

// ── invites_pii ──────────────────────────────────────────────────────────────

export async function getInvitePiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, InvitePii>> {
  if (ids.length === 0) return new Map()
  const rows = await readUnderRls<{ id: string; email: string }>(orgId, (client) =>
    client
      .query<{
        id: string
        email: string
      }>('SELECT id, email FROM invites_pii WHERE org_id = $1 AND id = ANY($2)', [orgId, [...ids]])
      .then((res) => res.rows),
  )
  return new Map(rows.map((r) => [r.id, { email: r.email }] as const))
}

export async function upsertInvitePii(input: {
  orgId: string
  id: string
  email: string
}): Promise<void> {
  await writeUnderOrg(input.orgId, (client) =>
    client.query(
      `INSERT INTO invites_pii (org_id, id, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, id) DO UPDATE SET email = EXCLUDED.email`,
      [input.orgId, input.id, input.email],
    ),
  )
}

export async function deleteInvitePii(orgId: string, id: string): Promise<void> {
  await writeUnderOrg(orgId, (client) =>
    client.query('DELETE FROM invites_pii WHERE org_id = $1 AND id = $2', [orgId, id]),
  )
}

// ── professionals_pii ──────────────────────────────────────────────────────────

export async function getProfessionalPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, ProfessionalPii>> {
  if (ids.length === 0) return new Map()
  const rows = await readUnderRls<{ id: string; tax_identity: unknown }>(orgId, (client) =>
    client
      .query<{
        id: string
        tax_identity: unknown
      }>('SELECT id, tax_identity FROM professionals_pii WHERE org_id = $1 AND id = ANY($2)', [
        orgId,
        [...ids],
      ])
      .then((res) => res.rows),
  )
  return new Map(
    rows.map((r) => [r.id, { taxIdentity: decodeTaxIdentity(r.tax_identity ?? null) }] as const),
  )
}

export async function upsertProfessionalPii(input: {
  orgId: string
  id: string
  taxIdentity: ProfessionalPii['taxIdentity']
}): Promise<void> {
  await writeUnderOrg(input.orgId, (client) =>
    client.query(
      `INSERT INTO professionals_pii (org_id, id, tax_identity)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, id) DO UPDATE SET tax_identity = EXCLUDED.tax_identity`,
      [
        input.orgId,
        input.id,
        input.taxIdentity === null ? null : JSON.stringify(input.taxIdentity),
      ],
    ),
  )
}

export async function deleteProfessionalPii(orgId: string, id: string): Promise<void> {
  await writeUnderOrg(orgId, (client) =>
    client.query('DELETE FROM professionals_pii WHERE org_id = $1 AND id = $2', [orgId, id]),
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
