import { getEventStorePool } from '@/shared/db/pg/pool'
import { getPublicOrgNamesByIds } from '@/shared/db/pg/public-org-directory'
import { readAsSubject } from '@/shared/db/pg/rls-read'
import 'server-only'

// Reverse index writer + reader — identity-layer graph of the establishments a
// data subject is a CUSTOMER of (brief 0032 / #1097, AC-10).
//
// Post-cutover (brief 0062) this lives in the Postgres `org_links` table under a
// PER-SUBJECT RLS policy (`user_id = current_setting('app.current_user_id')`):
// the subject reads/writes ONLY their own links. This is the generalization of
// the top-level `memberships` pattern (ADR 0004) — the identity↔org graph in the
// identity layer — so "where am I a customer?" is a per-user read scoped by the
// subject GUC, never a banned cross-org query. The establishment NAMES come from
// the public org directory (no org context needed — it is public by contract).

// Records that `userId` is a customer of `orgId`. Idempotent: `(user_id, org_id)`
// is the PK, so re-linking the same pair is a no-op that never duplicates or
// rewrites `linked_at`. Called as a saga step on customer creation (never on
// re-booking — the link already exists). NEVER carries PII.
export async function linkCustomerOrg(userId: string, orgId: string): Promise<void> {
  if (!userId || !orgId) return
  const pool = getEventStorePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // The per-subject RLS WITH CHECK requires the subject GUC to match `user_id`.
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId])
    await client.query(
      `INSERT INTO org_links (user_id, org_id, linked_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO NOTHING`,
      [userId, orgId, new Date().toISOString()],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Lists the org ids the subject is a customer of, reading ONLY their own rows
// (per-subject RLS). Returns an empty array for a subject with no links.
export async function listLinkedOrgIds(userId: string): Promise<string[]> {
  if (!userId) return []
  const rows = await readAsSubject<{ org_id: string }>(userId, (client) =>
    client
      .query<{ org_id: string }>('SELECT org_id FROM org_links WHERE user_id = $1', [userId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.org_id)
}

// True when the subject's OWN reverse index records that they are a customer of
// `orgId` — a per-subject read of a single row. Guards the self-service
// per-establishment erasure against acting on an org with no relationship.
export async function isLinkedToOrg(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false
  const rows = await readAsSubject<{ one: number }>(userId, (client) =>
    client
      .query<{
        one: number
      }>('SELECT 1 AS one FROM org_links WHERE user_id = $1 AND org_id = $2 LIMIT 1', [
        userId,
        orgId,
      ])
      .then((res) => res.rows),
  )
  return rows.length > 0
}

// A discovered establishment the subject is a customer of, for the
// settings/privacy list (brief 0032 / #1097, AC-10). `name` is the establishment
// BUSINESS name (not the subject's PII).
export type LinkedEstablishment = {
  orgId: string
  name: string
}

// Resolves the establishments the subject is a customer of, for display. Reads
// the subject's OWN links (per-subject RLS), then resolves each org's business
// name from the PUBLIC org directory (no org context needed — public by
// contract), in one round-trip. Orgs missing from the directory fall back to the
// id so the subject can still act on the link.
export async function listMyCustomerEstablishments(userId: string): Promise<LinkedEstablishment[]> {
  const orgIds = await listLinkedOrgIds(userId)
  if (orgIds.length === 0) return []
  const nameById = await getPublicOrgNamesByIds(orgIds)
  return orgIds
    .map((orgId) => {
      const name = nameById.get(orgId)
      return { orgId, name: name && name.length > 0 ? name : orgId }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
