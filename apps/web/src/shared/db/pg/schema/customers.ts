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

/**
 * Typed relational projection for the `customer` bounded context (migration
 * feature D, brief 0060, Grupo A) — the per-org shadow of a person known to a
 * org. PII (name/whatsapp/email/birthDate/avatarUrl) is materialized at read time
 * from the global `users/{userId}` doc and NEVER stored here (LGPD contract, ADR
 * 0010); the typed projection decodes against `StoredCustomer` (the PII-omitted
 * shape). Only the operational fields persist: the `userId` link and the two
 * distinct non-active markers.
 *
 * Keyed by composite PK (org_id, id). FK
 * `org_id → orgs.org_id`; `org_id` is the leading index column (RLS performance).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `user_id` NOT NULL and non-empty — no PII-only customers (#832/#836).
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 *
 * `archived_at` (LGPD per-org block, brief 0032) and `deactivated_at` (operator
 * removal, brief 0033) are nullable ISO-timestamp markers — distinct relations,
 * kept as separate columns so they never conflate (the read path applies them).
 */
export const customers = pgTable(
  'customers',
  {
    // ── Identity + org scope ────────────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    // FK into `users/{userId}` (global) — required, no PII-only customers. PII
    // (name/whatsapp/email/birthDate/avatarUrl) read live from there.
    userId: text('user_id').notNull(),

    // LGPD per-org terminal block (brief 0032). When set, the shadow is archived
    // (neutral label, write-guarded). Distinct from `deactivated_at`.
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    // Operator-side removal (brief 0033) — keeps the NAME in history. Distinct
    // from `archived_at` (the LGPD block) on purpose.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Natural composite PK — the target of cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'customers_pkey' }),
    // No PII-only customers (non-empty userId).
    check('customers_user_id_nonempty', sql`char_length(btrim(${table.userId})) > 0`),
    // Every customer belongs to a real org.
    foreignKey({
      name: 'customers_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // `org_id`-leading index: the RLS policy + list reads (`listCustomersForOrg`).
    index('customers_org_id_user_id_idx').on(table.orgId, table.userId),
  ],
)

export type StoredCustomerRow = typeof customers.$inferSelect
export type NewCustomerRow = typeof customers.$inferInsert
