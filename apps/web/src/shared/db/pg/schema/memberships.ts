import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { units } from './units'

/**
 * Typed relational projection for the `membership` bounded context (migration
 * feature C, brief 0059) — the user↔org join carrying role, status, granular
 * permissions and single-unit RLS scope.
 *
 * Keyed by composite PK (org_id, id) — `id` is the membership composite doc id
 * (`{orgId}_{userId}`). `org_id` is still
 * the leading index column (RLS performance requirement, feature C AC-01): the
 * org policy filters `org_id = current_setting('app.current_org')` and the unit
 * policy reads `rls_unit_scope` for the single-unit-locked scope.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `role ∈ {owner, manager, professional, receptionist, customer}` — enum CHECK.
 *   - `status ∈ {active, invited, suspended, revoked}` — enum CHECK.
 *   - `org_id`/`user_id`/`joined_at`/`updated_at` NOT NULL.
 *   - `org_id` NOT NULL leading column.
 *
 * `permissions` (the capability bag) is composite/structural state — a JSONB
 * faithful to the reduced state, not a per-capability column explosion.
 * `rls_unit_scope` is a nullable column (NOT JSONB) because the RLS unit policy
 * filters on it directly: `rls_unit_scope IS NULL` (org-wide) escapes the unit
 * predicate. Named `rls_unit_scope` (not `unit_id`) to disambiguate from
 * `professionals.unit_ids[]` (a professional's areas of operation) — this column
 * is the single-unit RLS lock of the membership (brief 0068 D4).
 */
export const memberships = pgTable(
  'memberships',
  {
    // ── Identity + org scope ────────────────────────────────────────────────
    // `org_id` leading column for the RLS policy + index. `id` is the bare doc
    // id (`{orgId}_{userId}`, the membership composite key).
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    userId: text('user_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    role: text('role').notNull(),
    status: text('status').notNull(),
    // `null` = org-wide; a non-null `rls_unit_scope` pins the membership to one
    // unit (the RLS unit policy reads this column directly). Renamed from
    // `unit_id` (brief 0068 D4) to disambiguate from `professionals.unit_ids[]`.
    rlsUnitScope: text('rls_unit_scope'),
    invitedBy: text('invited_by'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'string' }).notNull(),

    // ── Composite / structural state (JSONB; not primary-metric invariants) ──
    permissions: jsonb('permissions').notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Natural composite PK — `id` is the `{orgId}_{userId}` membership key.
    primaryKey({ columns: [table.orgId, table.id], name: 'memberships_pkey' }),
    // The role enum, as a CHECK.
    check(
      'memberships_role_check',
      sql`${table.role} IN ('owner', 'manager', 'professional', 'receptionist')`,
    ),
    // The status enum, as a CHECK.
    check(
      'memberships_status_check',
      sql`${table.status} IN ('active', 'invited', 'suspended', 'revoked')`,
    ),
    // No blank user id.
    check('memberships_user_id_nonempty', sql`char_length(btrim(${table.userId})) > 0`),
    // Every membership belongs to a real org.
    foreignKey({
      name: 'memberships_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Cross-aggregate composite FK (org-scoped). `user_id` is a global userId
    // (LGPD / users is global) — intentionally NOT an FK.
    foreignKey({
      name: 'memberships_rls_unit_scope_fk',
      columns: [table.orgId, table.rlsUnitScope],
      foreignColumns: [units.orgId, units.id],
      // The migration authors this as `SET NULL (rls_unit_scope)` (column-list
      // form, PG15+) so only the ref is nulled, never the NOT-NULL `org_id` (a
      // bare composite SET NULL → 23502). See migration 0016 header.
    }).onDelete('set null'),
    // `org_id`-leading indexes: the RLS policy + member-of-org lookups
    // (`listOrgMembers`) and the user's memberships lookup (`getUserMemberships`).
    index('memberships_org_id_user_id_idx').on(table.orgId, table.userId),
    index('memberships_user_id_idx').on(table.userId),
  ],
)

export type StoredMembershipRow = typeof memberships.$inferSelect
export type NewMembershipRow = typeof memberships.$inferInsert
