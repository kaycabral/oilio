import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const piiEvents = pgTable(
  'pii_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    orgId: text('org_id'),
    subjectRef: text('subject_ref').notNull(),
    scope: text('scope').notNull(),
    requestedBy: text('requested_by'),
    fieldsChanged: jsonb('fields_changed'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'pii_events_event_check',
      sql`${table.event} IN ('pii_erasure_requested', 'pii_anonymized', 'pii_rectified')`,
    ),
    check('pii_events_subject_ref_nonempty', sql`char_length(btrim(${table.subjectRef})) > 0`),
    index('pii_events_subject_ref_idx').on(table.subjectRef),
    index('pii_events_org_id_ts_idx').on(table.orgId, table.ts),
  ],
)

export type StoredPiiEventRow = typeof piiEvents.$inferSelect
export type NewPiiEventRow = typeof piiEvents.$inferInsert
