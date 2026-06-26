import { foreignKey, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * The deletable PII sidecar for professionals (migration feature F — cutover,
 * brief 0062). Mirrors the Firestore `orgs/{orgId}/professionals_pii/{id}` doc:
 * it holds the professional-scoped PII (`taxIdentity`) separate from the
 * `professionals` projection (which omits it). Personal identity
 * (name/whatsapp/email) is NOT here — that is read LIVE from the global `users`
 * table (#1046). Only `taxIdentity` (which can diverge per org and is severable
 * for LGPD per-org anonymization, brief 0032) lives in this deletable sidecar.
 *
 * Keyed by `aggregate_path` (`orgs/{orgId}/professionals_pii/{id}`), org-scoped.
 * Org RLS (org-only). Deleting the row erases the professional PII while the
 * `professionals` projection and its event history stay intact.
 *
 * `tax_identity` is JSONB (the PF/PJ discriminated union), nullable — a
 * professional may have no fiscal identity recorded yet.
 *
 * Invariants enforced HERE:
 *   - `org_id` NOT NULL leading column; FK `org_id → orgs.org_id`.
 */
export const professionalsPii = pgTable(
  'professionals_pii',
  {
    aggregatePath: text('aggregate_path').primaryKey(),
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    taxIdentity: jsonb('tax_identity'),
  },
  (table) => [
    foreignKey({
      name: 'professionals_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('professionals_pii_org_id_idx').on(table.orgId),
  ],
)

export type StoredProfessionalPiiRow = typeof professionalsPii.$inferSelect
export type NewProfessionalPiiRow = typeof professionalsPii.$inferInsert
