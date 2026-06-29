import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { memberOperations } from './member_operations'
import { orgs } from './orgs'

/**
 * Join table for the `member-operation ↔ service` N:N relation (brief 0068 D3;
 * renamed from `professional_services` in #1271) — the relational projection of
 * `member_operations.catalog_service_ids` (the JSONB array that, before D3,
 * forced "which operations perform service Y?" to fetch-all + filter in JS).
 *
 * Derived projection, same contract as `member_operation_units`: no version /
 * aggregate_path of its own; the truth is the `memberOperation` reduced state
 * (`catalog_service_ids`, reducer untouched); the projector rewrites these rows
 * in the same ACID tx (delete-then-insert); replay reconstructs from the array.
 *
 * Org-scoped under RLS (org-only). Composite FKs (D2 pattern): `(org_id,
 * member_operation_id) → member_operations(org_id, id)` CASCADE (derived from
 * parent); `(org_id, service_id) → catalog_items(org_id, id)` RESTRICT (a
 * service with linked operations can't be hard-deleted — consistent with
 * `appointments.service_id`).
 */
export const memberOperationServices = pgTable(
  'member_operation_services',
  {
    orgId: text('org_id').notNull(),
    memberOperationId: text('member_operation_id').notNull(),
    serviceId: text('service_id').notNull(),
  },
  (table) => [
    // Explicit name: the drizzle-derived default
    // (`member_operation_services_org_id_member_operation_id_service_id_pk`) is 66
    // chars and Postgres silently truncates at 63 (NAMEDATALEN), diverging from the
    // snapshot. Pin a ≤63-char name so schema, migration and DB agree.
    primaryKey({
      name: 'member_operation_services_org_id_member_op_service_pk',
      columns: [table.orgId, table.memberOperationId, table.serviceId],
    }),
    foreignKey({
      name: 'member_operation_services_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_operation_services_member_operation_id_fk',
      columns: [table.orgId, table.memberOperationId],
      foreignColumns: [memberOperations.orgId, memberOperations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_operation_services_service_id_fk',
      columns: [table.orgId, table.serviceId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }).onDelete('restrict'),
    // The index that pays for the join: the inverse query "operations for service Y".
    index('member_operation_services_org_id_service_id_idx').on(table.orgId, table.serviceId),
  ],
)

export type StoredMemberOperationServiceRow = typeof memberOperationServices.$inferSelect
export type NewMemberOperationServiceRow = typeof memberOperationServices.$inferInsert
