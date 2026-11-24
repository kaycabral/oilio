import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { categories } from './categories'

export const catalogItems = pgTable(
  'catalog_items',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    kind: text('kind').notNull(),
    name: text('name').notNull(),
    categoryId: text('category_id'),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    priceVisibility: text('price_visibility').notNull(),
    active: boolean('active').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    durationMinutes: bigint('duration_minutes', { mode: 'number' }),

    sku: text('sku'),
    stock: bigint('stock', { mode: 'number' }),
    gtin14: text('gtin14'),
    reconciliationPending: boolean('reconciliation_pending'),
    reconciliationLastAttempt: timestamp('reconciliation_last_attempt', {
      withTimezone: true,
      mode: 'string',
    }),

    commission: jsonb('commission'),
    unitIds: jsonb('unit_ids').notNull(),
    unitOverrides: jsonb('unit_overrides'),
    requiredResources: jsonb('required_resources'),
    publicVisible: boolean('public_visible').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('catalog_items_kind_check', sql`${table.kind} IN ('service', 'product')`),
    check('catalog_items_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check('catalog_items_unit_ids_nonempty', sql`jsonb_array_length(${table.unitIds}) > 0`),
    check('catalog_items_price_cents_nonneg', sql`${table.priceCents} >= 0`),
    check(
      'catalog_items_price_visibility_check',
      sql`${table.priceVisibility} IN ('visible', 'on_request')`,
    ),
    check(
      'catalog_items_kind_shape',
      sql`(
        ${table.kind} = 'service'
        AND ${table.durationMinutes} IS NOT NULL
        AND ${table.sku} IS NULL
        AND ${table.stock} IS NULL
        AND ${table.gtin14} IS NULL
        AND ${table.reconciliationPending} IS NULL
        AND ${table.reconciliationLastAttempt} IS NULL
      ) OR (
        ${table.kind} = 'product'
        AND ${table.durationMinutes} IS NULL
        AND ${table.stock} IS NOT NULL
      )`,
    ),
    primaryKey({ columns: [table.orgId, table.id], name: 'catalog_items_pkey' }),
    foreignKey({
      name: 'catalog_items_category_id_fk',
      columns: [table.orgId, table.categoryId],
      foreignColumns: [categories.orgId, categories.id],
    }).onDelete('set null'),
    index('catalog_items_org_id_name_idx').on(table.orgId, table.name),
    index('catalog_items_org_id_active_idx').on(table.orgId, table.active),
  ],
)

export type StoredCatalogItem = typeof catalogItems.$inferSelect
export type NewCatalogItem = typeof catalogItems.$inferInsert
