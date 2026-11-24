import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { memberOperations } from './member_operations'
import { memberships } from './memberships'
import { orgs } from './orgs'
import { units } from './units'

export const agendaBlocks = pgTable(
  'agenda_blocks',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    kind: text('kind').notNull(),
    memberOperationId: text('member_operation_id'),
    memberId: text('member_id'),

    block: jsonb('block').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'agenda_blocks_pkey' }),
    check('agenda_blocks_kind_check', sql`${table.kind} IN ('recurring', 'one_off')`),
    check('agenda_blocks_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    foreignKey({
      name: 'agenda_blocks_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    foreignKey({
      name: 'agenda_blocks_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'agenda_blocks_member_operation_id_fk',
      columns: [table.orgId, table.memberOperationId],
      foreignColumns: [memberOperations.orgId, memberOperations.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'agenda_blocks_member_id_fk',
      columns: [table.orgId, table.memberId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete('set null'),
    index('agenda_blocks_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredAgendaBlockRow = typeof agendaBlocks.$inferSelect
export type NewAgendaBlockRow = typeof agendaBlocks.$inferInsert
