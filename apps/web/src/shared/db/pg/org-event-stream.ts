import type { FirestoreDoc } from '@/domain/effect'
import { getEventStorePool } from './pool'

export type OrgEventStreamWindow = {
  readonly orgId: string
  readonly fromIso: string
  readonly toIso: string
}

export type OrgEventRow = {
  readonly orgId: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly occurredAt: string
  readonly envelope: FirestoreDoc
}

type RawRow = {
  org_id: string
  aggregate_type: string
  aggregate_id: string
  occurred_at: string
  envelope: FirestoreDoc
}

export async function readOrgEventStream(
  window: OrgEventStreamWindow,
): Promise<readonly OrgEventRow[]> {
  const res = await getEventStorePool().query<RawRow>(
    `SELECT org_id, aggregate_type, aggregate_id, occurred_at, envelope
       FROM events
      WHERE org_id = $1
        AND occurred_at IS NOT NULL
        AND occurred_at >= $2
        AND occurred_at < $3
      ORDER BY occurred_at ASC, version ASC`,
    [window.orgId, window.fromIso, window.toIso],
  )
  return res.rows.map((row) => ({
    orgId: row.org_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    envelope: row.envelope,
  }))
}
