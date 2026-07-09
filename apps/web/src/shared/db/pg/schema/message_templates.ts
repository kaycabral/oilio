import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const messageTemplates = pgTable(
  'message_templates',
  {
    orgId: text('org_id').notNull(),
    type: text('type').notNull(),

    body: text('body'),
    enabled: boolean('enabled').notNull(),
    lastActorUid: text('last_actor_uid'),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('message_templates_type_nonempty', sql`char_length(btrim(${table.type})) > 0`),
    primaryKey({ columns: [table.orgId, table.type], name: 'message_templates_pkey' }),
    foreignKey({
      name: 'message_templates_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('message_templates_org_id_type_idx').on(table.orgId, table.type),
  ],
)

export type StoredMessageTemplateRow = typeof messageTemplates.$inferSelect
export type NewMessageTemplateRow = typeof messageTemplates.$inferInsert
