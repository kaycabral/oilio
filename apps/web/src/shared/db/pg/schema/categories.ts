import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * Typed relational projection for the `category` bounded context (migration
 * feature D, brief 0060, Grupo B) — the first-class catalog category
 * (`CatalogItem.categoryId` and `SubscriptionPlan.includedCategoryIds` are FKs
 * into it).
 *
 * Keyed by composite PK `(org_id, id)`. FK
 * `org_id → orgs.org_id`; `org_id` is the leading index column (RLS performance).
 *
 * No PII — the typed projection decodes against the full `Category` domain shape.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `name` NOT NULL and non-empty (trimmed).
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 *
 * `icon`/`color` are nullable visual cues; `active`/`archived_at` follow the
 * uniform delete policy (brief 0027) — an archived category drops from active
 * pickers but stays resolvable.
 */
export const categories = pgTable(
  'categories',
  {
    // ── Identity + org scope (composite PRIMARY KEY) ────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color'),
    active: boolean('active').notNull(),
    // `timestamptz` (brief 0068 D1): the DB owns the temporal type. `mode:'string'`
    // keeps `Category.archivedAt: string | null` unchanged; the projector's
    // `rowToDoc` normalizes the Postgres format back to ISO 8601 at the read
    // boundary. Same pattern as `appointments.start_at`.
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // No blank names (trimmed non-empty).
    check('categories_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    // Every category belongs to a real org.
    foreignKey({
      name: 'categories_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // Composite (org_id, id) PRIMARY KEY — the natural key + target of
    // cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'categories_pkey' }),
    // `org_id`-leading index: the RLS policy + list reads (ordered by name).
    index('categories_org_id_name_idx').on(table.orgId, table.name),
  ],
)

export type StoredCategoryRow = typeof categories.$inferSelect
export type NewCategoryRow = typeof categories.$inferInsert
