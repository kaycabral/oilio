import { foreignKey, index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * The deletable PII sidecar for member operations (migration feature F —
 * cutover, brief 0062; renamed from `professionals_pii` in #1271). Mirrors the
 * Firestore `orgs/{orgId}/professionals_pii/{id}` doc: it holds the
 * operation-scoped PII (`taxIdentity`) separate from the `member_operations`
 * projection (which omits it). Personal identity (name/mobile/email) is NOT
 * here — that is read LIVE from the global `users` table (#1046). Only
 * `taxIdentity` (which can diverge per org and is severable for LGPD per-org
 * anonymization, brief 0032) lives in this deletable sidecar.
 *
 * Keyed by composite PK `(org_id, id)`, org-scoped.
 * Org RLS (org-only). Deleting the row erases the operation's PII while the
 * `member_operations` projection and its event history stay intact.
 *
 * `tax_identity` is JSONB (the PF/PJ discriminated union), nullable — an
 * operational profile may have no fiscal identity recorded yet.
 *
 * Invariants enforced HERE:
 *   - `org_id` NOT NULL leading column; FK `org_id → orgs.org_id`.
 */
export const memberOperationsPii = pgTable(
  'member_operations_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    taxIdentity: jsonb('tax_identity'),
  },
  (table) => [
    // Composite (org_id, id) PRIMARY KEY — the natural key.
    primaryKey({ columns: [table.orgId, table.id], name: 'member_operations_pii_pkey' }),
    foreignKey({
      name: 'member_operations_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('member_operations_pii_org_id_idx').on(table.orgId),
  ],
)

export type StoredMemberOperationPiiRow = typeof memberOperationsPii.$inferSelect
export type NewMemberOperationPiiRow = typeof memberOperationsPii.$inferInsert
