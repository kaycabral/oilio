import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { professionals } from './professionals'
import { units } from './units'

/**
 * Typed relational projection for the `agenda-block` bounded context (migration
 * feature D, brief 0060, Grupo C) — a recurring or one-off block in a unit's
 * agenda.
 *
 * Keyed by `aggregate_path` (`orgs/{orgId}/agenda_blocks/{id}` — org-scoped
 * collection, like the Firestore layout). FK `org_id → orgs.org_id`; `org_id` is
 * the leading index column (RLS performance). `unit_id` is a NOT NULL column —
 * a block always lives within a unit's agenda — and is the RLS unit predicate
 * (brief 0060, Grupo C: agenda-block gets unit-scoped RLS).
 *
 * Union mapping (mirrors the unit `agenda`/`fiscal` pattern): the `kind`
 * (recurring | one_off) discriminant is a TEXT+CHECK column; the full variant
 * body (weekday/open/close for recurring; startAt/endAt for one_off) rides in the
 * `block` JSONB so the read round-trips to the exact domain union without a
 * nullable-column explosion.
 *
 * No PII: agenda blocks carry no personal data (a `reason` string + scope ids).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `kind ∈ {recurring, one_off}` — the discriminant CHECK.
 *   - `unit_id` NOT NULL and non-empty — a block always belongs to a unit.
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 */
export const agendaBlocks = pgTable(
  'agenda_blocks',
  {
    aggregatePath: text('aggregate_path').primaryKey(),

    // ── Identity + org/unit scope ───────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    // A block always lives within a unit's agenda — the RLS unit predicate.
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    version: bigint('version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    // The union discriminant — the body lives in the `block` JSONB.
    kind: text('kind').notNull(),
    // Optional professional scope: when set, only that professional is blocked;
    // null = whole-unit block.
    professionalId: text('professional_id'),

    // ── Composite / structural state (JSONB) ────────────────────────────────
    // The full variant body: { reason, weekday, open, close, startAt, endAt }.
    block: jsonb('block').notNull(),

    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The kind discriminant, refused at the DB.
    check('agenda_blocks_kind_check', sql`${table.kind} IN ('recurring', 'one_off')`),
    // A block always belongs to a unit (non-empty unitId).
    check('agenda_blocks_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    // Every block belongs to a real org.
    foreignKey({
      name: 'agenda_blocks_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // Cross-aggregate composite FKs (org-scoped).
    foreignKey({
      name: 'agenda_blocks_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'agenda_blocks_professional_id_fk',
      columns: [table.orgId, table.professionalId],
      foreignColumns: [professionals.orgId, professionals.id],
      // The migration authors this as `SET NULL (professional_id)` (column-list
      // form, PG15+) so only the ref is nulled, never the NOT-NULL `org_id` (a
      // bare composite SET NULL → 23502). See migration 0016 header.
    }).onDelete('set null'),
    // `org_id`-leading indexes: the RLS policy + per-unit agenda reads.
    index('agenda_blocks_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredAgendaBlockRow = typeof agendaBlocks.$inferSelect
export type NewAgendaBlockRow = typeof agendaBlocks.$inferInsert
