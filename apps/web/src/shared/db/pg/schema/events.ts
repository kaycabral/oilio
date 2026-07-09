import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),

    version: bigint('version', { mode: 'number' }).notNull(),

    orgId: text('org_id'),

    envelope: jsonb('envelope').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    unique('events_aggregate_id_version_key').on(
      table.aggregateType,
      table.orgId,
      table.aggregateId,
      table.version,
    ),
    check('events_version_positive', sql`${table.version} > 0`),
    index('events_aggregate_id_version_idx').on(
      table.aggregateType,
      table.orgId,
      table.aggregateId,
      table.version,
    ),
    index('events_org_id_idx').on(table.orgId, table.aggregateType, table.version),
    index('events_org_id_occurred_at_idx').on(table.orgId, table.occurredAt),
  ],
)

export type StoredEvent = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
