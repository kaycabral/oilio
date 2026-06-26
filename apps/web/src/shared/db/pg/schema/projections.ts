import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Generic projection store for the relational event store (brief 0057).
 *
 * The event store is aggregate-agnostic: a projection is keyed by composite PK
 * `(org_id, id)`. The reduced state lives in `state` (JSONB), the same untyped
 * shape the reducer projects, so the PersistencePort stays neutral and no
 * per-context table is needed for an aggregate that doesn't warrant one.
 *
 * The event row (in `events`) and its projection row here are written in the
 * SAME transaction — a rollback leaves ZERO rows in both (the ACID invariant
 * that eliminates stream↔projection divergence).
 *
 * Org-scoped aggregates use a typed, richly-constrained projection table (with
 * RLS) registered via `registerTypedProjector`; this generic store is the
 * fallback for org-neutral aggregates that don't need one. NOTE: it has no RLS
 * policy — do not route an org-scoped aggregate here (see brief 0066 / F5).
 */
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
