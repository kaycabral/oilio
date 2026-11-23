import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Provenance of a `Product` row. NO `orgId` ever lives on this table — the base
 * is cross-org/sovereign (PRD decision: soberania/LGPD). `source` is the only
 * origin marker the table carries.
 *   - official      — curated/authoritative source.
 *   - external      — pulled from an external data source (GS1/Icecat/OFF — A2+).
 *   - org-contributed — auto-contributed when a business registered an unseen GTIN.
 */
export const productSource = pgEnum('product_source', ['official', 'external', 'org-contributed'])

/**
 * Physical measures of a product (intrinsic — shared across all sellers). Stored
 * as JSONB so the partition stays flexible without a migration per attribute.
 */
export interface ProductMeasures {
  readonly weightGrams?: number
  readonly heightMm?: number
  readonly widthMm?: number
  readonly depthMm?: number
}

/**
 * The sovereign `Product`. Holds ONLY what is intrinsic to the product in the
 * world (what it IS), shared across every business. Seller-specific data (price,
 * stock, fiscal treatment) belongs to the oilio `CatalogItem`, NOT here.
 *
 * Identity: `gtin14` is the canonical key — normalized GTIN-14, UNIQUE + NOT NULL.
 * 1 GTIN = 1 product. Integrity is enforced by the DATABASE (constraints below),
 * not by application code — proven by integration tests against real Postgres.
 */
export const product = pgTable(
  'product',
  {
    // Canonical key: normalized GTIN-14 (zero-padded). UNIQUE → idempotent upserts.
    gtin14: text('gtin14').primaryKey(),

    // Intrinsic descriptive attributes (PRD canonical partition → Product).
    name: text('name').notNull(),
    description: text('description'),
    brand: text('brand'),
    photoUrl: text('photo_url'),
    measures: jsonb('measures').$type<ProductMeasures>(),

    // Intrinsic fiscal attributes (product-level, not seller-level).
    // ncm: Mercosul Common Nomenclature code (intrinsic to the product).
    ncm: text('ncm'),
    // cest: Tax Substitution Specifier code.
    cest: text('cest'),
    // utrib: unit of taxable commerce.
    utrib: text('utrib'),

    // Taxonomy (google_product_category-style) — intrinsic classification.
    category: text('category'),

    source: productSource('source').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The key must be exactly 14 digits — the normalized GTIN-14 form. The DB
    // refuses any non-normalized key even if application code slips. The UNIQUE +
    // NOT NULL guarantee the canonical key (and A2's idempotent upsert) relies on
    // comes from the PRIMARY KEY on `gtin14` — no separate unique index needed.
    check('product_gtin14_is_14_digits', sql`${table.gtin14} ~ '^[0-9]{14}$'`),
    check('product_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    // Trigram GIN index backing the name autocomplete (brief 0055, feature D).
    // `gin_trgm_ops` lets `pg_trgm` similarity / `%` use the index instead of a
    // full scan. Requires the `pg_trgm` extension (created in migration 0001,
    // hand-added — drizzle-kit does not emit `CREATE EXTENSION`).
    index('product_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
  ],
)

export type StoredProduct = typeof product.$inferSelect
export type NewProduct = typeof product.$inferInsert
