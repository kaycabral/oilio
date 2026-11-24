import { DEFAULT_UNIT_TIMEZONE, type Org, StoredOrg, normalizeOrgBranding } from '@/domain'
import { type OrgRow, rowToDoc } from '@/shared/db/pg/effect/org-projector'
import { getPublicOrgDocBySlug } from '@/shared/db/pg/public-org-directory'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrg = Schema.decodeUnknownSync(StoredOrg)

function normalizeOrg(t: StoredOrg): Org {
  return {
    ...t,
    branding: normalizeOrgBranding(t.branding),
  }
}

export async function getOrg(orgId: string): Promise<Org | null> {
  const rows = await readUnderRls<OrgRow>(orgId, (client) =>
    client.query<OrgRow>('SELECT * FROM orgs WHERE org_id = $1', [orgId]).then((res) => res.rows),
  )
  const row = rows[0]
  return row ? normalizeOrg(decodeOrg(rowToDoc(row))) : null
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const doc = await getPublicOrgDocBySlug(slug)
  if (!doc) return null
  return normalizeOrg(decodeOrg(doc))
}

export async function getOrgRepresentativeTimezone(orgId: string): Promise<string> {
  const units = await listUnitsForOrg(orgId)
  return units[0]?.timezone ?? DEFAULT_UNIT_TIMEZONE
}
