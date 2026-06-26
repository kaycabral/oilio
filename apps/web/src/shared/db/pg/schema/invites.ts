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
 * Typed relational projection for the `invite` bounded context (migration feature
 * D, brief 0060, Grupo A) — a pending/accepted/expired/revoked invitation to join
 * a org with a role.
 *
 * Keyed by composite PK (org_id, id). FK
 * `org_id → orgs.org_id`; `org_id` is the leading index column (RLS performance).
 *
 * PII (`email`) does NOT enter this typed table — it lives in the deletable
 * `invites_pii/{id}` sidecar (LGPD contract, ADR 0010) and is merged at read time.
 * The typed projection decodes against `StoredInvite` (the email-omitted shape).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `role ∈ {owner, manager, professional, receptionist, customer}` — CHECK.
 *   - `status ∈ {pending, accepted, expired, revoked}` — CHECK.
 *   - acceptance consistency: `accepted_by_uid`/`accepted_at` are both present
 *     for an accepted invite and both NULL for a pending one — the domain
 *     refinement (`inviteAcceptanceConsistent`) lifted to a DB CHECK.
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 */
export const invites = pgTable(
  'invites',
  {
    // ── Identity + org scope ────────────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status').notNull(),
    invitedBy: text('invited_by').notNull(),
    // Present SSE accepted, NULL while pending (acceptance-consistency CHECK).
    acceptedByUid: text('accepted_by_uid'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Natural composite PK.
    primaryKey({ columns: [table.orgId, table.id], name: 'invites_pkey' }),
    // The role enum, refused at the DB.
    check(
      'invites_role_check',
      sql`${table.role} IN ('owner', 'manager', 'professional', 'receptionist')`,
    ),
    // The status enum, refused at the DB.
    check(
      'invites_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'expired', 'revoked')`,
    ),
    // Acceptance consistency (the domain refinement, lifted to the DB): an
    // accepted invite carries who/when; a pending one carries neither. expired/
    // revoked stay tolerant of legacy data from a prior acceptance.
    check(
      'invites_acceptance_consistency',
      sql`(
        ${table.status} = 'accepted'
        AND ${table.acceptedByUid} IS NOT NULL
        AND ${table.acceptedAt} IS NOT NULL
      ) OR (
        ${table.status} = 'pending'
        AND ${table.acceptedByUid} IS NULL
        AND ${table.acceptedAt} IS NULL
      ) OR ${table.status} IN ('expired', 'revoked')`,
    ),
    // Every invite belongs to a real org.
    foreignKey({
      name: 'invites_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // `org_id`-leading indexes: the RLS policy + list reads + status filters.
    index('invites_org_id_status_idx').on(table.orgId, table.status),
  ],
)

export type StoredInviteRow = typeof invites.$inferSelect
export type NewInviteRow = typeof invites.$inferInsert
