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
import { memberships } from './memberships'
import { orgs } from './orgs'

/**
 * Typed relational projection for the `professional` bounded context (migration
 * feature D, brief 0060, Grupo A) — the operational projection of a
 * `Membership(role=professional)` + `User`, born from the invite-acceptance saga.
 *
 * Keyed by composite PK `(org_id, id)`. FK
 * `org_id → orgs.org_id`; `org_id` is the leading index column (RLS performance).
 *
 * PII (name/whatsapp/email read LIVE from the global `users/{userId}` doc, and
 * `taxIdentity` in the deletable `professionals_pii/{id}` sidecar) does NOT enter
 * this typed table — it stays in the sidecars (LGPD contract, ADR 0010), exactly
 * as the Firestore layer keeps it. The typed projection decodes against
 * `StoredProfessional` (the PII-omitted shape).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `user_id` NOT NULL and non-empty — a Professional is never a standalone
 *     entity with a null link (#1045 / brief 0028 AC-01).
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 *
 * `operational_status` is NOT stored (brief 0068 D4 / #1226 AC-02) — it is
 * derived on read from real facts (whatsapp present ∧ ≥1 unit ∧ ≥1 service).
 *
 * Composite/structural state (`default_commission`, `unit_ids`,
 * `catalog_service_ids`) lives in JSONB — faithful to the reduced state without
 * inventing relational shape this context doesn't need.
 */
export const professionals = pgTable(
  'professionals',
  {
    // ── Identity + org scope (composite PRIMARY KEY) ────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    // FK into `users/{userId}` (global) — non-null (#1045). PII (name/whatsapp/
    // email) read live from there; `taxIdentity` from `professionals_pii`.
    userId: text('user_id').notNull(),

    // The membership this operational profile hangs off (brief 0076 AC-02). A
    // profile cannot exist without its membership: the composite FK
    // `(org_id, member_id) → memberships(org_id, id)` with `ON DELETE cascade`
    // kills the drift at the root — demoting/removing the membership removes the
    // profile, so there is no orphan row. `member_id` is the membership doc id
    // (`{orgId}_{userId}`), derived deterministically in the projector from the
    // reduced `userId` (it does NOT enter the event payload). Non-empty.
    memberId: text('member_id').notNull(),

    // ── Composite / structural state (JSONB; not primary-metric invariants) ──
    defaultCommission: jsonb('default_commission'),
    unitIds: jsonb('unit_ids').notNull(),
    catalogServiceIds: jsonb('catalog_service_ids').notNull(),

    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // A Professional is never linked to nothing (non-empty userId).
    check('professionals_user_id_nonempty', sql`char_length(btrim(${table.userId})) > 0`),
    // The operational profile is never linked to nothing (non-empty memberId).
    check('professionals_member_id_nonempty', sql`char_length(btrim(${table.memberId})) > 0`),
    // Every professional belongs to a real org.
    foreignKey({
      name: 'professionals_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // The operational profile hangs off the membership (brief 0076 AC-02): a
    // profile cannot exist without its membership, and `ON DELETE cascade` means
    // it disappears when the membership is removed — drift dead at the root.
    foreignKey({
      name: 'professionals_member_id_fk',
      columns: [table.orgId, table.memberId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete('cascade'),
    // Composite (org_id, id) PRIMARY KEY — the natural key + target of
    // cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'professionals_pkey' }),
    // `org_id`-leading indexes: the RLS policy + list reads
    // (`listProfessionalsForOrg`) + the per-user lookup (`getProfessionalByUserId`).
    index('professionals_org_id_user_id_idx').on(table.orgId, table.userId),
    // Supports the composite FK to `memberships` + cascade lookups.
    index('professionals_org_id_member_id_idx').on(table.orgId, table.memberId),
  ],
)

export type StoredProfessionalRow = typeof professionals.$inferSelect
export type NewProfessionalRow = typeof professionals.$inferInsert
