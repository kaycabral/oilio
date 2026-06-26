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
import { orgs } from './orgs'

/**
 * Typed relational projection for the `subscription-plan` bounded context
 * (migration feature D, brief 0060, Grupo B) — a recurring plan with coverage,
 * scope rules and a billing cycle.
 *
 * Keyed by `aggregate_path` (`orgs/{orgId}/subscription_plans/{id}`). FK
 * `org_id → orgs.org_id`; `org_id` is the leading index column (RLS performance).
 *
 * No PII — the typed projection decodes against the full `SubscriptionPlan`
 * domain shape.
 *
 * Union mapping (mirrors the catalog-item `service | product` / unit
 * `agenda`/`fiscal` pattern — discriminant column + JSONB body, no column
 * explosion):
 *   - `usageLimit` (unlimited | count) → `usage_limit_kind` TEXT+CHECK
 *     discriminant column + `usage_limit` JSONB body (carries `quantity` for the
 *     `count` variant). The discriminant is queryable + refused at the DB; the
 *     body stays JSONB (the `quantity` only exists for `count`).
 *   - `allowedTimeScope` / `bookingLimits` are OPTIONAL structs (absent/null =
 *     unrestricted), not discriminated unions → nullable JSONB bodies. Their
 *     sub-fields are independently optional (see the domain types).
 *
 * Composite/array coverage (`included_item_ids`, `included_category_ids`,
 * `unit_allowlist`) lives in JSONB — faithful to the reduced state.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `name` NOT NULL and non-empty (trimmed).
 *   - `price_cents` ≥ 0.
 *   - `billing_cycle ∈ {monthly, quarterly, semiannual, annual}` — CHECK.
 *   - `usage_limit_kind ∈ {unlimited, count}` — the union discriminant CHECK.
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 */
export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    aggregatePath: text('aggregate_path').primaryKey(),

    // ── Identity + org scope ────────────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    version: bigint('version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    name: text('name').notNull(),
    description: text('description'),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    billingCycle: text('billing_cycle').notNull(),
    active: boolean('active').notNull(),
    // ISO timestamp (text, mirrors `archivedAt: string | null`).
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    // Usage-limit union discriminant — the body (incl. `count` quantity) lives in
    // the `usage_limit` JSONB.
    usageLimitKind: text('usage_limit_kind').notNull(),

    // ── Composite / union bodies (JSONB; not primary-metric invariants) ──────
    usageLimit: jsonb('usage_limit').notNull(),
    includedItemIds: jsonb('included_item_ids').notNull(),
    includedCategoryIds: jsonb('included_category_ids').notNull(),
    // Optional scope rules (absent/null = unrestricted on that axis).
    unitAllowlist: jsonb('unit_allowlist'),
    allowedTimeScope: jsonb('allowed_time_scope'),
    bookingLimits: jsonb('booking_limits'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // No blank names (trimmed non-empty).
    check('subscription_plans_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    // No negative prices.
    check('subscription_plans_price_cents_nonneg', sql`${table.priceCents} >= 0`),
    // The billing-cycle enum, refused at the DB.
    check(
      'subscription_plans_billing_cycle_check',
      sql`${table.billingCycle} IN ('monthly', 'quarterly', 'semiannual', 'annual')`,
    ),
    // The usage-limit union discriminant, refused at the DB.
    check(
      'subscription_plans_usage_limit_kind_check',
      sql`${table.usageLimitKind} IN ('unlimited', 'count')`,
    ),
    // Every plan belongs to a real org.
    foreignKey({
      name: 'subscription_plans_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // Composite (org_id, id) UNIQUE — the target of cross-aggregate composite FKs.
    unique('subscription_plans_org_id_id_uq').on(table.orgId, table.id),
    // `org_id`-leading index: the RLS policy + list reads (ordered by name).
    index('subscription_plans_org_id_name_idx').on(table.orgId, table.name),
  ],
)

export type StoredSubscriptionPlanRow = typeof subscriptionPlans.$inferSelect
export type NewSubscriptionPlanRow = typeof subscriptionPlans.$inferInsert
