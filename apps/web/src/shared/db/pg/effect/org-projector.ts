import type { FirestoreDoc } from '@/domain/effect'
import { StoredOrg } from '@/domain/types/org'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `org` context (brief 0059, AC-01/AC-05) — the second
 * family of contexts (after the catalog-item pilot) plugged into the
 * per-context typed-projection registry, WITHOUT reopening the `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `StoredOrg` schema at
 * this single driver boundary (schema-validated, no cast leaks), then maps it
 * onto the `orgs` columns: the primary-metric scalars (name/slug/vertical/owner)
 * as DB-constrained columns, `branding` as JSONB. The DB enforces the invariants
 * (vertical enum CHECK, non-empty name/slug/owner) — a violation rolls back the
 * event + projection together.
 *
 * `org_id` equals the org's bare `id` (the org is its own scope) — kept explicit
 * so the RLS policy (`org_id = current_setting('app.current_org')`, feature C
 * Sub B) filters uniformly across every typed table.
 */

const decodeOrg = Schema.decodeUnknownSync(StoredOrg)

/**
 * The ordered `orgs` column list — the single source of truth for the runtime
 * upsert and the E2E seed (a new column added in ONE place; the two writers
 * never drift). Mirrors the `INSERT` placeholders 1:1.
 */
export const ORG_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'version',
  'name',
  'slug',
  'vertical',
  'website',
  'owner_user_id',
  'branding',
  'created_at',
  'updated_at',
] as const

/**
 * Map a decoded `StoredOrg` (+ aggregate path and projection version) onto the
 * ordered `orgs` column VALUES — the inverse of `rowToDoc`, shared by the runtime
 * projector and the E2E seed. Order matches `ORG_COLUMNS` exactly.
 */
export function orgColumnValues(org: StoredOrg, aggregatePath: string, version: number): unknown[] {
  return [
    aggregatePath,
    // org_id = the org's own id (it IS its own scope)
    org.id,
    org.id,
    version,
    org.name,
    org.slug,
    org.vertical,
    org.website ?? null,
    org.ownerUserId,
    org.branding,
    org.createdAt,
    org.updatedAt,
  ]
}

const PLACEHOLDERS = ORG_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = ORG_COLUMNS.filter((c) => c !== 'aggregate_path')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO orgs (${ORG_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (aggregate_path) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

// The public directory upsert — the SAME `org` event materializes the public
// `slug → org` row (brief 0062). Written in the same transaction as the
// org-scoped projection so the two never drift. Carries ONLY public fields.
// Exported as the SINGLE source of truth: the e2e seed reuses it (and
// `publicOrgDirectoryValues`) so a schema change here can't drift the fixtures.
export const PUBLIC_DIRECTORY_UPSERT = `
  INSERT INTO public_org_directory
    (org_id, slug, name, vertical, website, owner_user_id, branding, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (org_id) DO UPDATE SET
    slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    vertical = EXCLUDED.vertical,
    website = EXCLUDED.website,
    owner_user_id = EXCLUDED.owner_user_id,
    branding = EXCLUDED.branding,
    updated_at = EXCLUDED.updated_at
`

// Positional params for PUBLIC_DIRECTORY_UPSERT, derived from the org doc — the
// 1:1 companion to the SQL above (matches the `$1..$9` order). Single source for
// the projector + the e2e seed.
export function publicOrgDirectoryValues(org: StoredOrg): unknown[] {
  return [
    org.id,
    org.slug,
    org.name,
    org.vertical,
    org.website ?? null,
    org.ownerUserId,
    org.branding,
    org.createdAt,
    org.updatedAt,
  ]
}

async function upsert(
  client: PoolClient,
  aggregatePath: string,
  state: FirestoreDoc,
): Promise<void> {
  const org = decodeOrg(state)
  await client.query(UPSERT, orgColumnValues(org, aggregatePath, stateVersion(state)))
  // Mirror the public fields into the public directory (same tx).
  await client.query(PUBLIC_DIRECTORY_UPSERT, publicOrgDirectoryValues(org))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type OrgRow = {
  org_id: string
  id: string
  version: string | number
  name: string
  slug: string
  vertical: string
  website: string | null
  owner_user_id: string
  branding: unknown
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` is re-attached so the event store versions/replays
// correctly. `website` is optional on the domain shape — re-attached only when
// present so an org without it round-trips to the same shape.
export function rowToDoc(row: OrgRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    name: row.name,
    slug: row.slug,
    vertical: row.vertical,
    ...(row.website === null ? {} : { website: row.website }),
    ownerUserId: row.owner_user_id,
    branding: row.branding,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<OrgRow>('SELECT * FROM orgs WHERE aggregate_path = $1', [
    aggregatePath,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM orgs WHERE aggregate_path = $1', [aggregatePath])
  // The aggregate path is `orgs/{id}`; the directory is keyed by that bare id.
  const orgId = aggregatePath.split('/')[1] ?? ''
  await client.query('DELETE FROM public_org_directory WHERE org_id = $1', [orgId])
}

// No `list`: `orgs` is under FORCE ROW LEVEL SECURITY (per-org), so a
// platform-wide tenant sweep can't read it under a NOBYPASSRLS runtime role. The
// crons enumerate tenants from the PUBLIC `public_org_directory` (no RLS, by
// contract) instead — see `listAllOrgIds`. The org projection is only ever read
// by aggregate path (`read`), always under an org's RLS context.
export const orgProjector: TypedProjector = { read, upsert, delete: remove }

/**
 * `aggregate_type` for orgs = the aggregate-type segment of the event-store path
 * (`orgs/{id}` → `orgs`). The Postgres Layer derives the same tag with
 * `aggregateTypeOf`, so registration and routing agree.
 */
export const ORG_AGGREGATE_TYPE = 'orgs'

registerTypedProjector(ORG_AGGREGATE_TYPE, orgProjector)
