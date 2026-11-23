import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const productSource = pgEnum('product_source', ['official', 'external', 'org-contributed'])

export interface ProductMeasures {
  readonly weightGrams?: number
  readonly heightMm?: number
  readonly widthMm?: number
  readonly depthMm?: number
}

export const product = pgTable(
  'product',
  {
    gtin14: text('gtin14').primaryKey(),

    name: text('name').notNull(),
    description: text('description'),
    brand: text('brand'),
    photoUrl: text('photo_url'),
    measures: jsonb('measures').$type<ProductMeasures>(),

    ncm: text('ncm'),
    cest: text('cest'),
    utrib: text('utrib'),

    category: text('category'),

    source: productSource('source').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('product_gtin14_is_14_digits', sql`${table.gtin14} ~ '^[0-9]{14}$'`),
    check('product_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    index('product_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
  ],
)

export type StoredProduct = typeof product.$inferSelect
export type NewProduct = typeof product.$inferInsert
