import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Typed relational projection for the `org` bounded context (migration feature C,
 * brief 0059) — the org folder/shell (PRD Identidade v2): a pure identity record
 * with NO fiscal (moved to `Unit.fiscal`) and NO agenda config (moved to
 * `Unit.agenda`). The SECOND family of contexts migrated off the generic
 * `projections` JSONB store, plugged via the typed-projector registry the pilot
 * (feature B) extracted — without reopening the `PersistencePort`.
 *
 * Keyed by `aggregate_path` (`orgs/{id}` — the org is top-level, not org-scoped
 * under another org) so it lines up 1:1 with the event stream's `aggregate_id`.
 * `org_id` equals the bare `id` here (the org IS its own scope) and is the
 * leading index column — the RLS performance requirement (feature C, AC-01): the
 * org policy filters `org_id = current_setting('app.current_org')`.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `vertical ∈ {barbershop, auto_wash, auto_detailing, other}` — the segment
 *     enum, as a CHECK (TEXT + CHECK, not a pg enum, to stay aligned with the
 *     domain's `Schema.Literal` source of truth — ADR 0011 D3).
 *   - `name`/`slug`/`owner_user_id` NOT NULL and non-empty (trimmed).
 *   - `org_id` NOT NULL leading column.
 *
 * `branding` (logoUrl/bannerUrl/description) is composite/structural state, not a
 * primary-metric invariant, so it lives in JSONB — faithful to the reduced state.
 * `website` is nullable text (optional brand domain).
 */
export const orgs = pgTable(
  'orgs',
  {
    // Projection key = the Firestore-style aggregate path (`orgs/{id}`).
    aggregatePath: text('aggregate_path').primaryKey(),

    // ── Identity + org scope ────────────────────────────────────────────────
    // `org_id` leading column for the RLS policy + index. For an org row it
    // equals `id` (the org is its own scope), kept explicit so every typed table
    // shares the same `org_id` filter shape under RLS. UNIQUE (inline constraint,
    // present before the `units.org_id` FK ALTER) — one org row per org, and the
    // org policy filters a single row.
    orgId: text('org_id').notNull().unique(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`) — the event store
    // reads it to compute the next event version on append and to rehydrate on
    // replay.
    version: bigint('version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    vertical: text('vertical').notNull(),
    website: text('website'),
    ownerUserId: text('owner_user_id').notNull(),

    // ── Composite / structural state (JSONB; not primary-metric invariants) ──
    branding: jsonb('branding').notNull(),

    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The segment enum, as a CHECK.
    check(
      'orgs_vertical_check',
      sql`${table.vertical} IN ('barbershop', 'auto_wash', 'auto_detailing', 'other')`,
    ),
    // No blank names/slugs/owner (trimmed non-empty).
    check('orgs_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check('orgs_slug_nonempty', sql`char_length(btrim(${table.slug})) > 0`),
    check('orgs_owner_user_id_nonempty', sql`char_length(btrim(${table.ownerUserId})) > 0`),
    // Slug is unique within the platform (public namespace) — public org page
    // resolves `getOrgBySlug`.
    index('orgs_slug_idx').on(table.slug),
  ],
)

export type StoredOrgRow = typeof orgs.$inferSelect
export type NewOrgRow = typeof orgs.$inferInsert
