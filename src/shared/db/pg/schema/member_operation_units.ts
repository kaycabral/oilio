import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { memberOperations } from './member_operations'
import { orgs } from './orgs'
import { units } from './units'

export const memberOperationUnits = pgTable(
  'member_operation_units',
  {
    orgId: text('org_id').notNull(),
    memberOperationId: text('member_operation_id').notNull(),
    unitId: text('unit_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.memberOperationId, table.unitId] }),
    foreignKey({
      name: 'member_operation_units_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_operation_units_member_operation_id_fk',
      columns: [table.orgId, table.memberOperationId],
      foreignColumns: [memberOperations.orgId, memberOperations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_operation_units_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    index('member_operation_units_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredMemberOperationUnitRow = typeof memberOperationUnits.$inferSelect
export type NewMemberOperationUnitRow = typeof memberOperationUnits.$inferInsert
