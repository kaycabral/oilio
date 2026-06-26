import { foreignKey, index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * The deletable fiscal-PII sidecar for units (migration feature F — cutover,
 * brief 0062). Mirrors the Firestore
 * `orgs/{orgId}/units/{unitId}/private/taxIdentity` doc: it holds the
 * name-bearing fiscal fields of a FORMALIZED unit (`legalName` / `tradeName`,
 * brief 0048 AC-03). A MEI's razão social embeds the owner's civil name, so
 * these are PII and live in this deletable sidecar, NEVER in the
 * `unit.formalized` event (ADR 0010). The non-PII fiscal union (`Unit.fiscal` =
 * CNPJ-14 + CompanyProfile) stays on the `units` projection.
 *
 * `tax_identity` is JSONB (the PF/PJ discriminated union), nullable — a unit may
 * be informal (no fiscal identity recorded).
 *
 * Keyed by composite PK (org_id, id), org-scoped. Org RLS (org-only). Deleting
 * the row erases the fiscal PII while
 * the `units` projection + event history stay intact.
 *
 * Invariants enforced HERE:
 *   - `org_id` NOT NULL leading column; FK `org_id → orgs.org_id`.
 */
export const unitTaxIdentity = pgTable(
  'unit_tax_identity',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    taxIdentity: jsonb('tax_identity'),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'unit_tax_identity_pkey' }),
    foreignKey({
      name: 'unit_tax_identity_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('unit_tax_identity_org_id_idx').on(table.orgId),
  ],
)

export type StoredUnitTaxIdentityRow = typeof unitTaxIdentity.$inferSelect
export type NewUnitTaxIdentityRow = typeof unitTaxIdentity.$inferInsert
