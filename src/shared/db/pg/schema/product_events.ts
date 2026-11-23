import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const productEvents = pgTable(
  'product_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    gtin14: text('gtin14'),
    result: text('result'),
    source: text('source'),
    latencyMs: bigint('latency_ms', { mode: 'number' }),
    queryLen: bigint('query_len', { mode: 'number' }),
    resultCount: bigint('result_count', { mode: 'number' }),
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
    index('product_events_gtin14_ts_idx').on(table.gtin14, table.ts),
    index('product_events_event_ts_idx').on(table.event, table.ts),
  ],
)

export type StoredProductEventRow = typeof productEvents.$inferSelect
export type NewProductEventRow = typeof productEvents.$inferInsert
