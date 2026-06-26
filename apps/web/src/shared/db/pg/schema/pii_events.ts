import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The append-only `pii_events` audit log (migration feature F — cutover, brief
 * 0062). The LGPD lifecycle (brief 0032 / #1066, AC-07) emits three auditable
 * events — `pii_erasure_requested`, `pii_anonymized`, `pii_rectified` — carrying
 * NO PII: only opaque refs (the org id, an opaque `subject_ref`, the `scope`, and
 * `fields_changed` as field NAMES only). Mirrors the Firestore `pii_events/`
 * collection the privacy domain wrote to as the sanctioned fallback.
 *
 * INSERT-only (an audit log is never updated or deleted). No `aggregate_path` /
 * `version` — this is not a projection, it is a flat event record.
 *
 * NO Row-Level Security: `org_id` is NULLABLE (some erasure events are cross-org)
 * and this is a best-effort audit sink, not org-scoped operational data read back
 * under an org context. When the vendor-neutral `track()` layer (brief 0026)
 * ships, this becomes one adapter behind it without touching the call-sites.
 *
 * Invariants enforced HERE:
 *   - `event ∈ {pii_erasure_requested, pii_anonymized, pii_rectified}` — CHECK.
 *   - `subject_ref` non-empty; `ts` NOT NULL.
 */
export const piiEvents = pgTable(
  'pii_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    // Nullable: cross-org erasure events carry no single org.
    orgId: text('org_id'),
    // Opaque subject id (userId or anonymized subject code) — never PII.
    subjectRef: text('subject_ref').notNull(),
    scope: text('scope').notNull(),
    requestedBy: text('requested_by'),
    // Field NAMES only (never values) — JSONB array of strings.
    fieldsChanged: jsonb('fields_changed'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'pii_events_event_check',
      sql`${table.event} IN ('pii_erasure_requested', 'pii_anonymized', 'pii_rectified')`,
    ),
    check('pii_events_subject_ref_nonempty', sql`char_length(btrim(${table.subjectRef})) > 0`),
    // Audit reads by subject (erasure proof) and by org+time.
    index('pii_events_subject_ref_idx').on(table.subjectRef),
    index('pii_events_org_id_ts_idx').on(table.orgId, table.ts),
  ],
)

export type StoredPiiEventRow = typeof piiEvents.$inferSelect
export type NewPiiEventRow = typeof piiEvents.$inferInsert
