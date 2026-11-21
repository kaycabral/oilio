import type { StoredDoc } from '@/domain/effect'
import { getEventStorePool } from './pool'

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

function rowToOrgDoc(row: PublicOrgRow): StoredDoc {
  return {
    id: row.org_id,
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

export async function listAllOrgIds(): Promise<string[]> {
  const res = await getEventStorePool().query<{ org_id: string }>(
    'SELECT org_id FROM public_org_directory',
  )
  return res.rows.map((r) => r.org_id)
}

export async function getPublicOrgDocBySlug(slug: string): Promise<StoredDoc | null> {
  const res = await getEventStorePool().query<PublicOrgRow>(
    'SELECT * FROM public_org_directory WHERE slug = $1 LIMIT 1',
    [slug],
  )
  const row = res.rows[0]
  return row ? rowToOrgDoc(row) : null
}

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
