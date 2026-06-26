import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { categories } from './categories'

/**
 * Typed relational projection for the `catalog_item` bounded context (migration
 * feature B, brief 0058) — the FIRST real context migrated off the generic
 * `projections` JSONB store.
 *
 * This is the pilot of the iniciativa's primary metric: the catalog-item's
 * invariants are enforced by the DATABASE (CHECK / enum-as-CHECK / NOT NULL),
 * not just by application code. The Postgres Layer routes a `catalog_item`
 * projection write here (via the typed-projector registry) instead of to the
 * generic `projections` table — in the SAME transaction as the event, so a
 * rollback leaves zero rows in both (the ACID invariant inherited from A, now
 * over a typed table).
 *
 * Keyed by `aggregate_path` (the SAME string the Firestore layer uses as the doc
 * path, `orgs/{orgId}/catalog_items/{id}`) so it lines up 1:1 with the event
 * stream's `aggregate_id` and the generic projection key — the typed projector
 * and the generic fallback share the routing seam.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `kind ∈ {service, product}` — the discriminant, refused at the DB.
 *   - `name` NOT NULL and non-empty (trimmed) — no blank catalog entries.
 *   - `price_cents` ≥ 0 — no negative prices.
 *   - `price_visibility ∈ {visible, on_request}` — the enum, as a CHECK.
 *   - `org_id` NOT NULL leading column — every item is org-scoped (prepared for
 *     RLS in feature C, like `events.org_id`).
 *   - product-only columns (`sku`, `stock`, `gtin14`, `reconciliation_*`) are
 *     NULL when `kind = 'service'` (conditional CHECK) — V0 single-table mapping
 *     of the `service | product` union (brief 0058 § Riscos: reopen to
 *     table-per-kind only if the conditional CHECKs become ungovernable).
 *
 * Composite/structural fields that are NOT a primary-metric invariant
 * (`commission`, `unit_ids`, `unit_overrides`, `required_resources`) live in
 * JSONB — faithful to the reduced state, without inventing relational shape the
 * pilot doesn't need. `kind`/`price_visibility` are TEXT + CHECK (not a pg enum)
 * to stay aligned with the domain's `Schema.Literal` source of truth and avoid a
 * separate enum-migration lifecycle (ADR 0011 D3: a rename must not drop+add).
 */
export const catalogItems = pgTable(
  'catalog_items',
  {
    // Projection key = the Firestore-style aggregate path
    // (`orgs/{orgId}/catalog_items/{id}`). Matches `events.aggregate_id` and the
    // generic `projections.aggregate_path` so the routing seam is uniform.
    aggregatePath: text('aggregate_path').primaryKey(),

    // ── Identity + org scope ────────────────────────────────────────────────
    // `org_id` leading column — every item is org-scoped (prepared for RLS,
    // feature C). `id` is the bare doc id (last path segment) for convenience.
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`). The event store
    // reads this to compute the next event version on append and to rehydrate on
    // replay — the typed table is the projection, so it must carry the version
    // the generic `projections.state._version` carried.
    version: bigint('version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    categoryId: text('category_id'),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    priceVisibility: text('price_visibility').notNull(),
    active: boolean('active').notNull(),
    // ISO timestamp (text, mirrors the domain `archivedAt: string | null`) — an
    // archived item drops from the active catalog but stays resolvable.
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    // ── Service-only ────────────────────────────────────────────────────────
    durationMinutes: bigint('duration_minutes', { mode: 'number' }),

    // ── Product-only (NULL when kind = 'service', enforced by CHECK) ─────────
    sku: text('sku'),
    stock: bigint('stock', { mode: 'number' }),
    gtin14: text('gtin14'),
    reconciliationPending: boolean('reconciliation_pending'),
    reconciliationLastAttempt: timestamp('reconciliation_last_attempt', {
      withTimezone: true,
      mode: 'string',
    }),

    // ── Composite / structural state (JSONB; not primary-metric invariants) ──
    commission: jsonb('commission'),
    unitIds: jsonb('unit_ids').notNull(),
    unitOverrides: jsonb('unit_overrides'),
    requiredResources: jsonb('required_resources'),
    publicVisible: boolean('public_visible').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The discriminant, refused at the DB.
    check('catalog_items_kind_check', sql`${table.kind} IN ('service', 'product')`),
    // No blank names (trimmed non-empty).
    check('catalog_items_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    // No negative prices.
    check('catalog_items_price_cents_nonneg', sql`${table.priceCents} >= 0`),
    // The price-visibility enum, as a CHECK.
    check(
      'catalog_items_price_visibility_check',
      sql`${table.priceVisibility} IN ('visible', 'on_request')`,
    ),
    // Single-table union mapping (brief 0058 V0): product-only columns must be
    // NULL for a service; a service must carry its `duration_minutes`. A product
    // carries `stock` (NOT NULL for products) and a nullable `sku`/`gtin14`.
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
    // Composite (org_id, id) UNIQUE — the target of cross-aggregate composite FKs.
    unique('catalog_items_org_id_id_uq').on(table.orgId, table.id),
    // Cross-aggregate composite FK (org-scoped).
    foreignKey({
      name: 'catalog_items_category_id_fk',
      columns: [table.orgId, table.categoryId],
      foreignColumns: [categories.orgId, categories.id],
      // The migration authors this as `SET NULL (category_id)` (column-list form,
      // PG15+): deleting a category re-buckets its items to "Sem categoria" by
      // nulling only `category_id`, never the NOT-NULL `org_id` (which a bare
      // composite SET NULL would hit → 23502). See migration 0016 header.
    }).onDelete('set null'),
    // List/order reads filter+sort by org then name (`loadCatalogPage`).
    index('catalog_items_org_id_name_idx').on(table.orgId, table.name),
    // Active-catalog reads filter by org then active flag.
    index('catalog_items_org_id_active_idx').on(table.orgId, table.active),
  ],
)

export type StoredCatalogItem = typeof catalogItems.$inferSelect
export type NewCatalogItem = typeof catalogItems.$inferInsert
