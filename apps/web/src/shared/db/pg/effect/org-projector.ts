import { OrgConfig } from '@/domain/aggregates/org/config'
import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { StoredOrg } from '@/domain/types/org'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeOrg = Schema.decodeUnknownSync(StoredOrg)

export const ORG_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'name',
  'slug',
  'vertical',
  'website',
  'owner_user_id',
  'branding',
  'created_at',
  'updated_at',
] as const

export function orgColumnValues(org: StoredOrg, lastEventVersion: number): unknown[] {
  return [
    org.id,
    org.id,
    lastEventVersion,
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
const CONFLICT_SET = ORG_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO orgs (${ORG_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

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

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const org = decodeOrg(state)
  await client.query(UPSERT, orgColumnValues(org, stateVersion(state)))
  await client.query(PUBLIC_DIRECTORY_UPSERT, publicOrgDirectoryValues(org))
}

export type OrgRow = {
  org_id: string
  id: string
  last_event_version: string | number
  name: string
  slug: string
  vertical: string
  website: string | null
  owner_user_id: string
  branding: unknown
  created_at: string
  updated_at: string
}

export function rowToDoc(row: OrgRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
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

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<OrgRow>('SELECT * FROM orgs WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM orgs WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
  await client.query('DELETE FROM public_org_directory WHERE org_id = $1', [ref.orgId])
}

export const orgProjector: TypedProjector = { read, upsert, delete: remove }

export const ORG_AGGREGATE_TYPE = OrgConfig.type

registerTypedProjector(ORG_AGGREGATE_TYPE, orgProjector)
