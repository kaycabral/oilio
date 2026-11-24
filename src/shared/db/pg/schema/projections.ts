import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const projections = pgTable(
  'projections',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    state: jsonb('state').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.id], name: 'projections_pkey' })],
)

export type StoredProjection = typeof projections.$inferSelect
