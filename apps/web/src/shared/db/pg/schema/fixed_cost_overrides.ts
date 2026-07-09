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
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { units } from './units'

export const fixedCostOverrides = pgTable(
  'fixed_cost_overrides',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),
    seriesId: text('series_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    month: text('month').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'fixed_cost_overrides_pkey' }),
    check('fixed_cost_overrides_amount_cents_positive', sql`${table.amountCents} >= 1`),
    check('fixed_cost_overrides_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    check(
      'fixed_cost_overrides_series_id_nonempty',
      sql`char_length(btrim(${table.seriesId})) > 0`,
    ),
    check('fixed_cost_overrides_month_shape', sql`${table.month} ~ '^[0-9]{4}-[0-9]{2}$'`),
    foreignKey({
      name: 'fixed_cost_overrides_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    foreignKey({
      name: 'fixed_cost_overrides_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('cascade'),
    uniqueIndex('fixed_cost_overrides_org_series_month_uq').on(
      table.orgId,
      table.seriesId,
      table.month,
    ),
    index('fixed_cost_overrides_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredFixedCostOverrideRow = typeof fixedCostOverrides.$inferSelect
export type NewFixedCostOverrideRow = typeof fixedCostOverrides.$inferInsert
