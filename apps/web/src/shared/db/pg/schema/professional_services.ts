import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { orgs } from './orgs'
import { professionals } from './professionals'

/**
 * Join table for the `professional ↔ service` N:N relation (brief 0068 D3) — the
 * relational projection of `professionals.catalog_service_ids` (the JSONB array
 * that, before D3, forced "which professionals perform service Y?" to fetch-all +
 * filter in JS).
 *
 * Derived projection, same contract as `professional_units`: no version /
 * aggregate_path of its own; the truth is the `professional` reduced state
 * (`catalog_service_ids`, reducer untouched); the projector rewrites these rows
 * in the same ACID tx (delete-then-insert); replay reconstructs from the array.
 *
 * Org-scoped under RLS (org-only). Composite FKs (D2 pattern): `(org_id,
 * professional_id) → professionals(org_id, id)` CASCADE (derived from parent);
 * `(org_id, service_id) → catalog_items(org_id, id)` RESTRICT (a service with
 * linked professionals can't be hard-deleted — consistent with
 * `appointments.service_id`).
 */
export const professionalServices = pgTable(
  'professional_services',
  {
    orgId: text('org_id').notNull(),
    professionalId: text('professional_id').notNull(),
    serviceId: text('service_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.professionalId, table.serviceId] }),
    foreignKey({
      name: 'professional_services_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_services_professional_id_fk',
      columns: [table.orgId, table.professionalId],
      foreignColumns: [professionals.orgId, professionals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_services_service_id_fk',
      columns: [table.orgId, table.serviceId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }).onDelete('restrict'),
    // The index that pays for the join: the inverse query "professionals for service Y".
    index('professional_services_org_id_service_id_idx').on(table.orgId, table.serviceId),
  ],
)

export type StoredProfessionalServiceRow = typeof professionalServices.$inferSelect
export type NewProfessionalServiceRow = typeof professionalServices.$inferInsert
