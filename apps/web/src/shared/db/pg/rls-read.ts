import type { PoolClient, QueryResultRow } from 'pg'
import { setRlsGucs, setSubjectGuc } from './guc'
import { getEventStorePool } from './pool'

/**
 * Normalize a caught value into the argument `PoolClient.release(err?)` expects.
 *
 * `release(err)` marks the connection as broken so `pg` DESTROYS it instead of
 * returning a wedged/half-open client to the pool. A clean path (no failure)
 * releases for reuse — so `undefined` maps to a plain release. A non-Error throw
 * still signals "destroy" via a sentinel Error (never stringifies the unknown
 * value, which could be `[object Object]`).
 */
function toReleaseError(failed: unknown): Error | undefined {
  if (failed === undefined) return undefined
  return failed instanceof Error ? failed : new Error('non-Error thrown from RLS read callback')
}

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
  memberOperationId = '',
): Promise<T[]> {
  const client = await getEventStorePool().connect()
  let failed: unknown
  try {
    await client.query('BEGIN')
    await setRlsGucs(client, orgId, unitId, memberOperationId)
    const rows = await fn(client)
    await client.query('COMMIT')
    return rows
  } catch (err) {
    failed = err
    // Best-effort ROLLBACK: if the connection itself is broken (a `57P01`
    // termination, a stalled socket), ROLLBACK also throws — swallow it so the
    // ORIGINAL error is what propagates, never the rollback's.
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    // Destroy a connection that errored instead of returning it to the pool:
    // `release(err)` tells `pg` to discard it, so a wedged/half-open client can't
    // be handed to the next caller (which would inherit the stall). A clean path
    // releases normally for reuse.
    client.release(toReleaseError(failed))
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
  let failed: unknown
  try {
    await client.query('BEGIN')
    await setSubjectGuc(client, userId)
    const rows = await fn(client)
    await client.query('COMMIT')
    return rows
  } catch (err) {
    failed = err
    // Best-effort ROLLBACK so the ORIGINAL error propagates even on a broken
    // connection (see readUnderRls).
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    // Destroy an errored connection instead of returning it to the pool (see
    // readUnderRls) so a wedged client can't be handed to the next caller.
    client.release(toReleaseError(failed))
  }
}
