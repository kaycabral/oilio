import type { PoolClient, QueryResultRow } from 'pg'
import { setRlsGucs, setSubjectGuc } from './guc'
import { getEventStorePool } from './pool'

/**
 * Run a backend-aware READ under RLS (brief 0059, feature C).
 *
 * The typed projections (`orgs`/`units`/`memberships`/`catalog_items`) are under
 * `FORCE ROW LEVEL SECURITY`: a read on a pooled connection with no
 * `app.current_org` set returns ZERO rows (fail-closed). The write path sets the
 * GUC inside `runTransaction`, but reads run OUTSIDE any transaction — so they
 * must set it themselves.
 *
 * This helper checks out a connection, opens a transaction, sets the RLS GUCs
 * with `SET LOCAL` (tx-scoped — they never leak back to the pooled connection,
 * which `max:5` reuses across requests), runs the caller's query, and commits.
 * `app.current_unit` is empty by default (org-wide); pass it for a single-unit
 * scope. The org id is interpolated (a GUC takes no bound parameter), sanitized
 * to `[A-Za-z0-9_-]` as a defense-in-depth guard.
 *
 * NOTE: this matters only with a non-superuser runtime role (production). The
 * ephemeral local/CI Postgres connects as superuser, which bypasses RLS — the
 * `rls-isolation` integration proof uses a dedicated role to exercise the
 * policies for real.
 */
export async function readUnderRls<T extends QueryResultRow>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T[]>,
  unitId = '',
): Promise<T[]> {
  const client = await getEventStorePool().connect()
  try {
    await client.query('BEGIN')
    await setRlsGucs(client, orgId, unitId)
    const rows = await fn(client)
    await client.query('COMMIT')
    return rows
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Run a READ scoped to the SUBJECT, not an org (brief 0062, feature F — the
 * identity layer). Sets `app.current_user_id` (tx-scoped) so the per-subject RLS
 * policy on `memberships` / `org_links` returns ONLY the caller's own rows.
 *
 * This is the read path for the questions that precede any org context — "which
 * orgs am I a member of?" (login / org switcher) and "where am I a customer?"
 * (LGPD establishment list). No `app.current_org` is set: the org-scoped policy
 * matches zero rows, and ONLY the per-subject policy admits the caller's rows.
 */
export async function readAsSubject<T extends QueryResultRow>(
  userId: string,
  fn: (client: PoolClient) => Promise<T[]>,
): Promise<T[]> {
  const client = await getEventStorePool().connect()
  try {
    await client.query('BEGIN')
    await setSubjectGuc(client, userId)
    const rows = await fn(client)
    await client.query('COMMIT')
    return rows
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
