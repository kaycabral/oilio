import type { PoolClient } from 'pg'

/**
 * Set the per-transaction RLS session vars `app.current_org` / `app.current_unit`
 * (brief 0059, feature C). MUST run inside an open transaction: `set_config(name,
 * value, true)` is the bound-parameter equivalent of `SET LOCAL` — tx-scoped, so
 * it never leaks back to the pooled connection (the `max:5` pool reuses
 * connections across requests).
 *
 * Bound params (not string interpolation) carry the id verbatim — zero injection
 * surface and no silent mangling of an id outside `[A-Za-z0-9_-]`. `org` null →
 * leave `app.current_org` unset (the org policy then matches zero rows:
 * fail-closed). `unit` empty string → org-wide (the permissive unit predicate).
 */
export async function setRlsGucs(
  client: PoolClient,
  org: string | null,
  unit: string,
): Promise<void> {
  if (org !== null) {
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org', org])
  }
  await client.query('SELECT set_config($1, $2, true)', ['app.current_unit', unit])
}

/**
 * Set the per-transaction SUBJECT var `app.current_user_id` (brief 0062, feature
 * F — the identity layer). MUST run inside an open transaction (same `SET LOCAL`
 * semantics as `setRlsGucs`).
 *
 * The identity-layer tables `memberships`, `org_links` carry a per-subject RLS
 * policy keyed on this GUC: a session reads ONLY its own rows ("which orgs am I a
 * member of / a customer of?"), without an `app.current_org` (those reads happen
 * BEFORE an org is active — login, org switcher, LGPD establishment list). An
 * unset GUC matches zero rows (fail-closed), exactly like `app.current_org`.
 */
export async function setSubjectGuc(client: PoolClient, userId: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId])
}
