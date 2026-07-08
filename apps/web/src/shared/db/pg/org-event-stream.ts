import type { FirestoreDoc } from '@/domain/effect'
import { getEventStorePool } from './pool'

/**
 * `readOrgEventStream` — the cross-aggregate, org-scoped, competence-windowed read
 * the Razão consumes (brief 0091, AC-04; ADR 0016 D4). Distinct from the event
 * store's per-aggregate `getEvents` (replay): this reads EVERY aggregate's events
 * for one org whose COMPETÊNCIA (`occurred_at`, materialized at append by
 * `competenceOf`) falls in `[fromIso, toIso)`, ordered by competência then
 * version. Events with no financial competência have `occurred_at = null` and are
 * excluded by the range predicate — only Razão-relevant facts come back.
 *
 * Scoping is `WHERE org_id = $1` on the raw pool, the SAME posture the replay path
 * uses today (getEvents reads without the `app.current_org` GUC). RLS on `events`
 * is DEFERRED to #1384: a probe (events-rls-replay-probe) proves FORCE RLS would
 * read zero rows on the no-GUC path and break both replay and this read; migrating
 * the read path to `readUnderRls` is that issue's work. Until then org isolation
 * here is the explicit `org_id` filter, exactly as replay relies on it.
 */

export type OrgEventStreamWindow = {
  readonly orgId: string
  // Half-open competence window [fromIso, toIso): fromIso inclusive, toIso
  // exclusive — so adjacent windows tile without double-counting a boundary event.
  readonly fromIso: string
  readonly toIso: string
}

// One row of the stream: the DB-column identity (org/type/aggregate id/competência)
// plus the raw persisted `envelope`. The adapter (features/finance) decodes the
// envelope against the aggregate schemas and maps it to a `LedgerFact` — the ACL
// that keeps the domain `classifyLedger` free of transport concerns.
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
    // `occurred_at` is a timestamptz (mode: 'string') — normalize to ISO so the
    // window/consumer never sees a Postgres-format string.
    occurredAt: new Date(row.occurred_at).toISOString(),
    envelope: row.envelope,
  }))
}
