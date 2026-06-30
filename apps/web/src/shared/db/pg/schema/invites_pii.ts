import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * The deletable PII sidecar for invites (migration feature F — cutover, brief
 * 0062). Mirrors the Firestore `orgs/{orgId}/invites_pii/{id}` doc: it holds the
 * invitee `email` separate from the `invites` projection (which is email-omitted),
 * so the email can be erased independently (LGPD contract, ADR 0010 — PII never in
 * an event payload; it lives in a mutable/deletable doc merged at read time).
 *
 * Keyed by composite PK (org_id, id), org-scoped. Org RLS
 * (org-only) — the email of an org's invite is org data. Deleting the row erases
 * the PII while the `invites` projection (and its event history) stays intact.
 *
 * Invariants enforced HERE:
 *   - `email` NOT NULL and non-empty (NOT NULL alone admits `''`; the email is
 *     the invite-accept match key, so a blank one breaks the accept flow
 *     silently — #1283).
 *   - `org_id` NOT NULL leading column.
 *   - FK `org_id → orgs.org_id`.
 */
export const invitesPii = pgTable(
  'invites_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    email: text('email').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'invites_pii_pkey' }),
    foreignKey({
      name: 'invites_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('invites_pii_org_id_idx').on(table.orgId),
    check('invites_pii_email_nonempty', sql`char_length(btrim(${table.email})) > 0`),
  ],
)

export type StoredInvitePiiRow = typeof invitesPii.$inferSelect
export type NewInvitePiiRow = typeof invitesPii.$inferInsert
