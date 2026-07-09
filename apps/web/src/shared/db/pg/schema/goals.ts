import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { units } from './units'

export const goals = pgTable(
  'goals',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    period: text('period').notNull(),
    type: text('type').notNull(),
    targetCents: bigint('target_cents', { mode: 'number' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'goals_pkey' }),
    check('goals_type_check', sql`${table.type} IN ('profit')`),
    check('goals_target_cents_positive', sql`${table.targetCents} >= 1`),
    check('goals_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    check('goals_period_nonempty', sql`char_length(btrim(${table.period})) > 0`),
    foreignKey({
      name: 'goals_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    foreignKey({
      name: 'goals_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('cascade'),
    index('goals_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredGoalRow = typeof goals.$inferSelect
export type NewGoalRow = typeof goals.$inferInsert
