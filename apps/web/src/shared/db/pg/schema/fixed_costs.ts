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

export const fixedCosts = pgTable(
  'fixed_costs',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),
    seriesId: text('series_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    name: text('name').notNull(),
    category: text('category').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'string' }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true, mode: 'string' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'fixed_costs_pkey' }),
    check('fixed_costs_amount_cents_positive', sql`${table.amountCents} >= 1`),
    check('fixed_costs_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check(
      'fixed_costs_category_check',
      sql`${table.category} IN ('expense_commercial', 'expense_admin', 'expense_financial')`,
    ),
    check('fixed_costs_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    check('fixed_costs_series_id_nonempty', sql`char_length(btrim(${table.seriesId})) > 0`),
    check(
      'fixed_costs_vigencia_coherent',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveFrom} < ${table.effectiveTo}`,
    ),
    foreignKey({
      name: 'fixed_costs_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    foreignKey({
      name: 'fixed_costs_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('cascade'),
    index('fixed_costs_org_id_unit_id_idx').on(table.orgId, table.unitId),
    index('fixed_costs_org_id_series_id_idx').on(table.orgId, table.seriesId),
  ],
)

export type StoredFixedCostRow = typeof fixedCosts.$inferSelect
export type NewFixedCostRow = typeof fixedCosts.$inferInsert
