import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { memberOperations } from './member_operations'
import { orgs } from './orgs'

export const memberOperationServices = pgTable(
  'member_operation_services',
  {
    orgId: text('org_id').notNull(),
    memberOperationId: text('member_operation_id').notNull(),
    serviceId: text('service_id').notNull(),
  },
  (table) => [
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
    index('member_operation_services_org_id_service_id_idx').on(table.orgId, table.serviceId),
  ],
)

export type StoredMemberOperationServiceRow = typeof memberOperationServices.$inferSelect
export type NewMemberOperationServiceRow = typeof memberOperationServices.$inferInsert
