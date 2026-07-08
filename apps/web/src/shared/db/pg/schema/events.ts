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
 *   - `UNIQUE(aggregate_type, org_id, aggregate_id, version)` — optimistic
 *     concurrency: two appends racing for the same version, the second is
 *     refused by the DB. The key is COMPOSITE because `aggregate_id` is the bare
 *     instance id (D6, ADR 0013) — no longer the globally-unique path string —
 *     so it identifies a stream only together with its `(aggregate_type, org_id)`
 *     siblings. A bare `(aggregate_id, version)` collides across orgs / aggregate
 *     types that legitimately reuse an id.
 *   - `version` is a positive monotonic integer per aggregate (CHECK > 0).
 *   - `envelope` is the JSONB body (`_tag`/timestamp/actorId/schemaVersion/
 *     payload) — the SAME shape the Firestore layer persists, so reducers and
 *     the replay decode path are untouched (PersistencePort generalizes the
 *     seam; the envelope contract is preserved).
 *
 * `org_id` scopes the stream. RLS on `events` is NOT enabled here (deferred to a
 * dedicated task — see below): `readOrgEventStream` (the Razão's windowed read)
 * scopes by `WHERE org_id = $1` in the query, the SAME isolation the core's
 * replay path already relies on today (`getEvents`/`getDoc` filter by org_id
 * without RLS). Enabling FORCE RLS here would return ZERO rows on the replay path
 * (it never sets the `app.current_org` GUC), breaking aggregate rehydration — an
 * empirical finding proven by `events-rls-replay-probe.events.pg.integration.test`.
 * Turning RLS on requires migrating `getEvents`/`getDoc` to run under
 * `readUnderRls` first; that is its own change (issue tracked). PII never lives in
 * the envelope (ADR 0010 D2), so the stream carries no PII regardless.
 *
 * `occurred_at` is the COMPETÊNCIA of the fact (accrual date), materialized from
 * the envelope payload at append time (ADR 0016 D4): the sale's `closedAt`, the
 * subscription's period start, the reversal's date — NOT `created_at` (write
 * clock). Indexed by `(org_id, occurred_at)` so the Razão window is a range scan
 * by competência. Null for events without financial competência (e.g. an order's
 * item edits) — those never enter the ledger.
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

    // Competência (accrual date) of the fact, derived from the envelope payload at
    // append time (ADR 0016 D4). Null for events with no financial competência.
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    // Optimistic concurrency: one row per (aggregate stream, version). The
    // stream is `(aggregate_type, org_id, aggregate_id)` because `aggregate_id`
    // is the bare instance id (D6) — bare `(aggregate_id, version)` would collide
    // across orgs / aggregate types reusing an id. A concurrent append for an
    // already-written version is refused by the DB, not the app.
    unique('events_aggregate_id_version_key').on(
      table.aggregateType,
      table.orgId,
      table.aggregateId,
      table.version,
    ),
    // Version is 1-based and monotonic — the DB rejects a non-positive version
    // even if application code slips.
    check('events_version_positive', sql`${table.version} > 0`),
    // Replay reads a single aggregate's stream in version order — this index
    // backs `WHERE aggregate_type = $1 AND org_id = $2 AND aggregate_id = $3
    // ORDER BY version` (the composite stream identity, D6).
    index('events_aggregate_id_version_idx').on(
      table.aggregateType,
      table.orgId,
      table.aggregateId,
      table.version,
    ),
    // Leading-`org_id` index for RLS-scoped stream reads by aggregate type.
    index('events_org_id_idx').on(table.orgId, table.aggregateType, table.version),
    // Razão window: range-scan a whole org's ledger facts by competência
    // (`readOrgEventStream` — brief 0091). `occurred_at` is null for non-financial
    // events, which the read filters out with `occurred_at IS NOT NULL`.
    index('events_org_id_occurred_at_idx').on(table.orgId, table.occurredAt),
  ],
)

export type StoredEvent = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
