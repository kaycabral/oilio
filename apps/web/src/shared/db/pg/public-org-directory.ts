import type { FirestoreDoc } from '@/domain/effect'
import { getEventStorePool } from './pool'

/**
 * Public read of the org directory (brief 0062, feature F) — the pre-auth
 * `slug → org` resolution for the public booking surface. Reads the intentionally
 * PUBLIC `public_org_directory` projection on the raw pool (no RLS — public by
 * contract; see the schema header). Returns the public `Org` doc shape the
 * read-model decoder expects, or null when no org owns the slug.
 *
 * This is the only read that runs with NO org context (it is resolving WHICH
 * org), so it cannot go through `readUnderRls`. By reading a dedicated public
 * projection — not `orgs` — the org-scoped table keeps its strict RLS and no
 * operational data is reachable here.
 */

type PublicOrgRow = {
  org_id: string
  slug: string
  name: string
  vertical: string
  website: string | null
  owner_user_id: string
  branding: unknown
  created_at: string
  updated_at: string
}

// Reconstruct the public `Org` doc shape (the same shape `org-projector.rowToDoc`
// produces) from a directory row, so existing `StoredOrg` decoders round-trip.
function rowToOrgDoc(row: PublicOrgRow): FirestoreDoc {
  return {
    id: row.org_id,
    name: row.name,
    slug: row.slug,
    vertical: row.vertical,
    ...(row.website === null ? {} : { website: row.website }),
    ownerUserId: row.owner_user_id,
    branding: row.branding,
    // timestamptz columns (brief 0068 D1) — normalize Postgres format to ISO.
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/**
 * Every org id on the platform — the tenant enumeration the platform-wide cron
 * jobs need (notifications hourly/daily, product reconciliation) to then read
 * each org's data org-scoped. Reads the PUBLIC directory (no RLS) so the sweep
 * is a single public read followed by N org-scoped reads — never a privileged
 * cross-org scan of the RLS-guarded `orgs` table (which a NOBYPASSRLS runtime
 * role would read as zero rows). The org-scoped reads that follow each id set
 * `app.current_org` as usual, so tenant isolation stays enforced by the DB.
 */
export async function listAllOrgIds(): Promise<string[]> {
  const res = await getEventStorePool().query<{ org_id: string }>(
    'SELECT org_id FROM public_org_directory',
  )
  return res.rows.map((r) => r.org_id)
}

export async function getPublicOrgDocBySlug(slug: string): Promise<FirestoreDoc | null> {
  const res = await getEventStorePool().query<PublicOrgRow>(
    'SELECT * FROM public_org_directory WHERE slug = $1 LIMIT 1',
    [slug],
  )
  const row = res.rows[0]
  return row ? rowToOrgDoc(row) : null
}

/**
 * Batch-resolve org business names by id from the public directory — for the
 * cross-org surfaces that label an org without an active org context (the org
 * switcher, the LGPD establishment list). Returns a `org_id → name` map; ids
 * absent from the directory are simply missing from the map.
 */
export async function getPublicOrgNamesByIds(
  orgIds: readonly string[],
): Promise<Map<string, string>> {
  if (orgIds.length === 0) return new Map()
  const res = await getEventStorePool().query<{ org_id: string; name: string }>(
    'SELECT org_id, name FROM public_org_directory WHERE org_id = ANY($1)',
    [[...orgIds]],
  )
  return new Map(res.rows.map((r) => [r.org_id, r.name] as const))
}
