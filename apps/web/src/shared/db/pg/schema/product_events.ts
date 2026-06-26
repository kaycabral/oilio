import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The append-only `product_events` engine telemetry log (migration feature F —
 * cutover, brief 0062). Sovereign-base engine observability (brief 0050 A2,
 * namespace `product.*`): lookup result, search observability, auto-contribution,
 * deferred contribution over a GTIN. CROSS-ORG by construction — NO `org_id`, NO
 * PII (the canonical Event Catalog § "product"). Mirrors the Firestore
 * `product_events/` collection the engine wrote to as the sanctioned fallback.
 *
 * INSERT-only (telemetry is never updated/deleted). The columns are the UNION of
 * the four event payloads; columns not relevant to an event type are NULL (e.g.
 * `gtin14` is null for `product_search`; `query_len`/`result_count` are null for
 * `product_lookup`).
 *
 * NO Row-Level Security: cross-org telemetry with no org scope. When the
 * vendor-neutral `track()` layer (brief 0026) ships, this becomes one adapter
 * behind it without touching the call-sites.
 *
 * Invariants enforced HERE:
 *   - `event ∈ {product_lookup, product_search, product_autocontributed,
 *     product_contribution_deferred}` — CHECK.
 *   - `ts` NOT NULL.
 */
export const productEvents = pgTable(
  'product_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    // product_lookup / product_autocontributed / product_contribution_deferred.
    gtin14: text('gtin14'),
    // product_lookup.
    result: text('result'),
    source: text('source'),
    latencyMs: bigint('latency_ms', { mode: 'number' }),
    // product_search.
    queryLen: bigint('query_len', { mode: 'number' }),
    resultCount: bigint('result_count', { mode: 'number' }),
    // product_contribution_deferred.
    reason: text('reason'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'product_events_event_check',
      sql`${table.event} IN (
        'product_lookup',
        'product_search',
        'product_autocontributed',
        'product_contribution_deferred'
      )`,
    ),
    // Engine hit-rate aggregation by GTIN+time and by event type+time (Wave 2).
    index('product_events_gtin14_ts_idx').on(table.gtin14, table.ts),
    index('product_events_event_ts_idx').on(table.event, table.ts),
  ],
)

export type StoredProductEventRow = typeof productEvents.$inferSelect
export type NewProductEventRow = typeof productEvents.$inferInsert
