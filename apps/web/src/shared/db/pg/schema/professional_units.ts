import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { professionals } from './professionals'
import { units } from './units'

/**
 * Join table for the `professional ↔ unit` N:N relation (brief 0068 D3) — the
 * relational projection of `professionals.unit_ids` (the JSONB array that, before
 * D3, forced "which professionals work at unit X?" to fetch-all + filter in JS).
 *
 * This is a DERIVED projection, not an aggregate: it has no `version` /
 * `aggregate_path` / timestamps of its own. The TRUTH stays in the `professional`
 * aggregate's reduced state (the `unit_ids` array is unchanged — the reducer is
 * untouched, ADR 0013 D3). The `professional` projector rewrites these rows in
 * the SAME ACID transaction as the parent upsert (delete-then-insert, so a
 * shrunk array leaves no orphans) — the multi-table-same-tx pattern of
 * `org-projector`'s `public_org_directory`. Replay reconstructs them from the
 * array; they are write-derived and never read to rehydrate the aggregate.
 *
 * Org-scoped under RLS (org-only policy, like `professionals`). Composite FKs
 * follow the D2 pattern: `(org_id, professional_id) → professionals(org_id, id)`
 * CASCADE (rows are derived from the parent — they go when it goes); `(org_id,
 * unit_id) → units(org_id, id)` RESTRICT (a unit with linked professionals can't
 * be hard-deleted, consistent with `agenda_blocks` + the app delete-guard).
 */
export const professionalUnits = pgTable(
  'professional_units',
  {
    orgId: text('org_id').notNull(),
    professionalId: text('professional_id').notNull(),
    unitId: text('unit_id').notNull(),
  },
  (table) => [
    // The triple is naturally unique — replay idempotency comes for free.
    primaryKey({ columns: [table.orgId, table.professionalId, table.unitId] }),
    foreignKey({
      name: 'professional_units_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_units_professional_id_fk',
      columns: [table.orgId, table.professionalId],
      foreignColumns: [professionals.orgId, professionals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_units_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    // The index that pays for the join: the inverse query "professionals at unit X".
    index('professional_units_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredProfessionalUnitRow = typeof professionalUnits.$inferSelect
export type NewProfessionalUnitRow = typeof professionalUnits.$inferInsert
