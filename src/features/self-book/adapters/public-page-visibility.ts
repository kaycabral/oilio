import { Address, isUnitPubliclyLive, UnitAgendaConfig } from '@/domain'
import type { PublicOrgVisibility } from '@/features/self-book/core/public-page-gate'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeLiveness = Schema.decodeUnknownSync(
  Schema.Struct({ address: Address, agenda: UnitAgendaConfig }),
)

type UnitLivenessRow = { slug: string; address: unknown; agenda: unknown }

export async function getPublicOrgVisibility(slug: string): Promise<PublicOrgVisibility> {
  const org = await getEventStorePool().query<{ org_id: string }>(
    'SELECT org_id FROM public_org_directory WHERE slug = $1 LIMIT 1',
    [slug],
  )
  const orgId = org.rows[0]?.org_id
  if (!orgId) return null
  const rows = await readUnderRls<UnitLivenessRow>(orgId, (client) =>
    client
      .query<UnitLivenessRow>(
        'SELECT slug, address, agenda FROM units WHERE org_id = $1 AND archived_at IS NULL',
        [orgId],
      )
      .then((res) => res.rows),
  )
  return {
    units: rows.map((row) => ({
      slug: row.slug,
      live: isUnitPubliclyLive(decodeLiveness({ address: row.address, agenda: row.agenda })),
    })),
  }
}
