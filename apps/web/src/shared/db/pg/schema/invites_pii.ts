import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * The deletable PII sidecar for invites (migration feature F — cutover, brief
 * 0062; channel normalized to WhatsApp in brief 0084). Holds the invitee
 * `mobile` separate from the `invites` projection (which is PII-omitted), so
 * the number can be erased independently (LGPD contract, ADR 0010 — PII never in
 * an event payload; it lives in a mutable/deletable doc merged at read time).
 *
 * Keyed by composite PK (org_id, id), org-scoped. Org RLS
 * (org-only) — the mobile of an org's invite is org data. Deleting the row
 * erases the PII while the `invites` projection (and its event history) stays
 * intact.
 *
 * WhatsApp replaced email as the delivery channel (brief 0084): it is the
 * establishment's real communication channel, and the accept flow no longer
 * matches on it — the signed token + first-accept-wins is the identity binding
 * (Google login yields an email, not a verified phone). The number here is the
 * DELIVERY target (the `wa.me` link), not an accept-time match key.
 *
 * Invariants enforced HERE:
 *   - `mobile` NOT NULL and non-empty (NOT NULL alone admits `''`; a blank one
 *     would produce a broken `wa.me` link — #1283 rationale, carried over).
 *   - `org_id` NOT NULL leading column.
 *   - FK `org_id → orgs.org_id`.
 */
export const invitesPii = pgTable(
  'invites_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    mobile: text('mobile').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'invites_pii_pkey' }),
    foreignKey({
      name: 'invites_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('invites_pii_org_id_idx').on(table.orgId),
    check('invites_pii_mobile_nonempty', sql`char_length(btrim(${table.mobile})) > 0`),
  ],
)

export type StoredInvitePiiRow = typeof invitesPii.$inferSelect
export type NewInvitePiiRow = typeof invitesPii.$inferInsert
