import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * The deletable PII sidecar for units (migration feature F — cutover, brief
 * 0062). Mirrors the Firestore `orgs/{orgId}/units_pii/{id}` doc: it holds the
 * unit-scoped contact PII (`whatsapp` / `email`, per `UnitPii`) separate from
 * the `units` projection (which omits it). Deleting the row erases the unit's
 * contact PII while the `units` projection and its event history stay intact
 * (ADR 0010 / LGPD).
 *
 * `whatsapp` is NOT NULL (a unit always has a contact number); `email` is
 * nullable (`UnitPii.email: string | null`).
 *
 * Keyed by composite PK (org_id, id), org-scoped. Org RLS (org-only).
 *
 * Invariants enforced HERE:
 *   - `org_id` NOT NULL leading column; FK `org_id → orgs.org_id`.
 *   - `whatsapp` non-empty (NOT NULL alone admits `''`; the unit's public
 *     contact is required per #822/#1283 — enforced at the DB, not only the form).
 */
export const unitsPii = pgTable(
  'units_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    whatsapp: text('whatsapp').notNull(),
    email: text('email'),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'units_pii_pkey' }),
    foreignKey({
      name: 'units_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('units_pii_org_id_idx').on(table.orgId),
    check('units_pii_whatsapp_nonempty', sql`char_length(btrim(${table.whatsapp})) > 0`),
  ],
)

export type StoredUnitsPiiRow = typeof unitsPii.$inferSelect
export type NewUnitsPiiRow = typeof unitsPii.$inferInsert
