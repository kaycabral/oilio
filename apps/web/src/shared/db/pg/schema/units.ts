import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

/**
 * Typed relational projection for the `unit` bounded context (migration feature
 * C, brief 0059) — the physical establishment under an org, carrying address,
 * timezone, the agenda config union and the fiscal identity union.
 *
 * Keyed by `aggregate_path` (`orgs/{orgId}/units/{id}` — org-scoped, mirroring
 * the Firestore layout). FK `org_id → orgs.org_id` (every unit belongs to a real
 * org). `org_id` is the leading index column (RLS performance requirement,
 * feature C AC-01).
 *
 * Union mapping (mirrors the catalog-item `service | product` pattern):
 *   - `agenda` (fixed | always_open | appointment) → a `agenda_mode` TEXT+CHECK
 *     discriminant column + `agenda` JSONB for the variant body (businessHours,
 *     and the appointment-only slotMinutes/cancellationPolicy/confirmation
 *     templates/self-booking publish state). The discriminant is a column so the
 *     mode is queryable and refused at the DB; the body stays JSONB (the
 *     appointment-only configs don't exist outside that variant — no nullable
 *     column explosion).
 *   - `fiscal` (informal | company) → a `fiscal_kind` TEXT+CHECK discriminant
 *     column + `fiscal` JSONB for the company body (taxId, companyProfile,
 *     formalizedAt). A unit is born `informal` and becomes `company` via
 *     `unit.formalized`.
 *
 * PII (whatsapp/email per `UnitPii`, and the fiscal civil-name nuance) does NOT
 * enter this typed table — it stays in the deletable `units_pii` / `private`
 * sidecars (LGPD contract, ADR 0010), exactly as the Firestore layer keeps it.
 * The typed projection decodes against `StoredUnit` (the PII-omitted shape).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `agenda_mode ∈ {fixed, always_open, appointment}` — the discriminant CHECK.
 *   - `fiscal_kind ∈ {informal, company}` — the discriminant CHECK.
 *   - `name`/`slug`/`timezone` NOT NULL and non-empty (trimmed).
 *   - FK `org_id → orgs.org_id`.
 *   - `org_id` NOT NULL leading column.
 */
export const units = pgTable(
  'units',
  {
    // Projection key = the Firestore-style aggregate path
    // (`orgs/{orgId}/units/{id}`).
    aggregatePath: text('aggregate_path').primaryKey(),

    // ── Identity + org scope ────────────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    version: bigint('version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    timezone: text('timezone').notNull(),
    // ISO timestamp (text, mirrors `archivedAt: string | null`) — an archived
    // unit drops from active lists/pickers but stays resolvable.
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    // Agenda union discriminant — the body lives in the `agenda` JSONB.
    agendaMode: text('agenda_mode').notNull(),
    // Fiscal union discriminant — the company body lives in the `fiscal` JSONB.
    fiscalKind: text('fiscal_kind').notNull(),

    // ── Composite / structural state (JSONB; not primary-metric invariants) ──
    // PII (whatsapp/email) intentionally ABSENT — sidecar `units_pii` (LGPD).
    address: jsonb('address').notNull(),
    // The full agenda variant body (businessHours + appointment-only configs).
    agenda: jsonb('agenda').notNull(),
    // The full fiscal variant body (informal: just kind; company: taxId +
    // companyProfile + formalizedAt). The civil-name nuance stays in `private`.
    fiscal: jsonb('fiscal').notNull(),
    publicVisible: boolean('public_visible'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The agenda mode discriminant, refused at the DB.
    check(
      'units_agenda_mode_check',
      sql`${table.agendaMode} IN ('fixed', 'always_open', 'appointment')`,
    ),
    // The fiscal kind discriminant, refused at the DB.
    check('units_fiscal_kind_check', sql`${table.fiscalKind} IN ('informal', 'company')`),
    // No blank names/slugs/timezone (trimmed non-empty).
    check('units_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check('units_slug_nonempty', sql`char_length(btrim(${table.slug})) > 0`),
    check('units_timezone_nonempty', sql`char_length(btrim(${table.timezone})) > 0`),
    // Every unit belongs to a real org.
    foreignKey({
      name: 'units_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // Composite (org_id, id) UNIQUE — the target of cross-aggregate composite FKs.
    unique('units_org_id_id_uq').on(table.orgId, table.id),
    // `org_id`-leading indexes: the RLS policy + list/order reads
    // (`listUnitsForOrg` filters by org then sorts by name).
    index('units_org_id_name_idx').on(table.orgId, table.name),
    index('units_org_id_slug_idx').on(table.orgId, table.slug),
  ],
)

export type StoredUnitRow = typeof units.$inferSelect
export type NewUnitRow = typeof units.$inferInsert
