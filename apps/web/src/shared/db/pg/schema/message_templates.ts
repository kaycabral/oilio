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

/**
 * The org-scoped `message_templates` config table (migration feature F —
 * cutover, brief 0062). The notification message library: per org, per
 * dispatchable notification type, the operator's customized body + enabled flag.
 *
 * NOT a domain aggregate and NOT event-sourced — it is a config doc, written
 * directly (`.set`) exactly as the Firestore `orgs/{orgId}/message_templates/{type}`
 * doc was. Keyed by composite PK `(org_id, type)` so a point read is a single-row
 * lookup; `(org_id, type)` is unique by construction (one template per type per
 * org).
 *
 * Org-scoped Row-Level Security (org-only, like every other org projection): the
 * RLS policy filters `org_id = current_setting('app.current_org')`, so reads go
 * through `readUnderRls`. `org_id` is the leading index column (RLS performance).
 *
 * Invariants enforced HERE:
 *   - `type` non-empty; `org_id` NOT NULL leading column.
 *   - FK `org_id → orgs.org_id`.
 *   - `enabled` NOT NULL boolean (state flag).
 */
export const messageTemplates = pgTable(
  'message_templates',
  {
    // ── Identity + org scope ────────────────────────────────────────────────
    orgId: text('org_id').notNull(),
    // The dispatchable notification type (the doc id) — `id` mirrors it.
    type: text('type').notNull(),

    // ── Config payload ──────────────────────────────────────────────────────
    // The owner's custom body. Null/empty falls back to the type's default at
    // read time (the store re-applies `DEFAULT_NOTIFICATION_TEMPLATES`).
    body: text('body'),
    enabled: boolean('enabled').notNull(),
    lastActorUid: text('last_actor_uid'),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // A template always targets a real notification type (non-empty).
    check('message_templates_type_nonempty', sql`char_length(btrim(${table.type})) > 0`),
    // Composite (org_id, type) PRIMARY KEY — one template per type per org.
    primaryKey({ columns: [table.orgId, table.type], name: 'message_templates_pkey' }),
    // Every template belongs to a real org.
    foreignKey({
      name: 'message_templates_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // `org_id`-leading index: the RLS policy + per-org template listing.
    index('message_templates_org_id_type_idx').on(table.orgId, table.type),
  ],
)

export type StoredMessageTemplateRow = typeof messageTemplates.$inferSelect
export type NewMessageTemplateRow = typeof messageTemplates.$inferInsert
