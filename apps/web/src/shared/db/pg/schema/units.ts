import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const units = pgTable(
  'units',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    name: text('name').notNull(),
    slug: text('slug').notNull(),
    timezone: text('timezone').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    agendaMode: text('agenda_mode').notNull(),
    fiscalKind: text('fiscal_kind').notNull(),

    address: jsonb('address').notNull(),
    agenda: jsonb('agenda').notNull(),
    fiscal: jsonb('fiscal').notNull(),
    publicVisible: boolean('public_visible'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'units_pkey' }),
    check(
      'units_agenda_mode_check',
      sql`${table.agendaMode} IN ('fixed', 'always_open', 'appointment')`,
    ),
    check('units_fiscal_kind_check', sql`${table.fiscalKind} IN ('informal', 'company')`),
    check('units_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check('units_slug_nonempty', sql`char_length(btrim(${table.slug})) > 0`),
    check('units_timezone_nonempty', sql`char_length(btrim(${table.timezone})) > 0`),
    check(
      'units_address_complete',
      sql`char_length(btrim(${table.address} ->> 'postalCode')) > 0
        AND char_length(btrim(${table.address} ->> 'state')) > 0
        AND char_length(btrim(${table.address} ->> 'city')) > 0
        AND char_length(btrim(${table.address} ->> 'neighborhood')) > 0
        AND char_length(btrim(${table.address} ->> 'street')) > 0`,
    ),
    check(
      'units_company_taxid_nonempty',
      sql`${table.fiscalKind} <> 'company' OR char_length(btrim(${table.fiscal} ->> 'taxId')) > 0`,
    ),
    foreignKey({
      name: 'units_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('units_org_id_name_idx').on(table.orgId, table.name),
    index('units_org_id_slug_idx').on(table.orgId, table.slug),
  ],
)

export type StoredUnitRow = typeof units.$inferSelect
export type NewUnitRow = typeof units.$inferInsert
