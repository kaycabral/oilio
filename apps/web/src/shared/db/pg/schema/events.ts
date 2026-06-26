import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

/**
 * Relational event store for the oilio (migration feature A, brief 0057).
 *
 * Append-only log of domain events. The stream is the source of truth; the
 * projection tables (per bounded context, materialized in the SAME transaction
 * as the event) derive from it. This is the FIRST transactional multi-table
 * Postgres of the oilio — the pattern features B…E follow.
 *
 * Invariants enforced by the DATABASE (not application code), proven by
 * integration tests against real Postgres:
 *   - `UNIQUE(aggregate_id, version)` — optimistic concurrency: two appends
 *     racing for the same version, the second is refused by the DB.
 *   - `version` is a positive monotonic integer per aggregate (CHECK > 0).
 *   - `envelope` is the JSONB body (`_tag`/timestamp/actorId/schemaVersion/
 *     payload) — the SAME shape the Firestore layer persists, so reducers and
 *     the replay decode path are untouched (PersistencePort generalizes the
 *     seam; the envelope contract is preserved).
 *
 * `org_id` is carried as a leading-index column PREPARED for RLS (feature C,
 * Onda 2) — RLS itself is NOT enabled here. PII never lives in the envelope
 * (ADR 0010 contract: aggregates reference an id; PII lives in a deletable doc).
 */
export const events = pgTable(
  'events',
  {
    // Surrogate PK: a gapless-per-aggregate ordering is given by `version`; this
    // id is just a stable row handle (BIGSERIAL).
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    // Aggregate identity. `aggregate_type` is the bounded-context tag (e.g.
    // 'orders', 'charges'); `aggregate_id` is the instance key.
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),

    // Monotonic per-aggregate version. The (aggregate_id, version) UNIQUE is the
    // optimistic-concurrency guard — the DB refuses a duplicate version.
    version: bigint('version', { mode: 'number' }).notNull(),

    // Org scope. Leading column of the index below — prepared for RLS (feature
    // C), NOT enabled now. Nullable: cross-org/system aggregates carry no org.
    orgId: text('org_id'),

    // The event envelope (`_tag`, version, timestamp, actorId, schemaVersion,
    // payload). Same shape the Firestore layer stores — reducers stay untouched.
    envelope: jsonb('envelope').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Optimistic concurrency: one row per (aggregate, version). A concurrent
    // append for an already-written version is refused by the DB, not the app.
    unique('events_aggregate_id_version_key').on(table.aggregateId, table.version),
    // Version is 1-based and monotonic — the DB rejects a non-positive version
    // even if application code slips.
    check('events_version_positive', sql`${table.version} > 0`),
    // Replay reads a single aggregate's stream in version order — this index
    // backs `WHERE aggregate_id = $1 ORDER BY version`.
    index('events_aggregate_id_version_idx').on(table.aggregateId, table.version),
    // Leading-`org_id` index PREPARED for RLS (feature C) and org-scoped reads.
    index('events_org_id_idx').on(table.orgId, table.aggregateType, table.version),
  ],
)

export type StoredEvent = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
