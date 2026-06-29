import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The append-only `client_funnel_events` telemetry log (brief 0077, Grupo D —
 * AC-12, Plano de medição § Eventos). The customer-acquisition funnel:
 * invite issued → opened → signed in → profile completed → appointment created.
 *
 * PII-ZERO by construction (the parede PII↔analytics, AC-12 + brief 0032): every
 * column is an opaque id (org/unit/actor/customer) or an attribution axis
 * (source/medium/campaign/intent) — NEVER a name, phone, email or birth date. The
 * subject's PII lives only on `users` + the apagável `*_pii` sidecars; the funnel
 * reasons over references. This is the transport described by brief 0026's
 * vendor-neutral `track()`: an append-only table now, one adapter behind `track()`
 * when that layer ships — the call-sites depend only on `emitClientFunnelEvent`.
 *
 * INSERT-only (telemetry is never updated/deleted). Columns are the UNION of the
 * five event payloads; irrelevant ones are NULL per event (e.g. `customer_id` is
 * null until `client_profile_completed`; `fields_filled` only on that event).
 *
 * NO Row-Level Security: this is analytics, read by the CDP/aggregation layer
 * across orgs, never by an org-scoped product query. `org_id` is an attribution
 * dimension here, not an isolation boundary.
 *
 * Invariants enforced HERE:
 *   - `event ∈ {client_invite_issued, client_invite_opened, client_signed_in,
 *     client_profile_completed, appointment_created}` — CHECK.
 *   - `intent ∈ {signup, booking}` when present — CHECK.
 *   - `org_id` + `ts` NOT NULL.
 */
export const clientFunnelEvents = pgTable(
  'client_funnel_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    // Attribution dimension (not an isolation boundary — see header).
    orgId: text('org_id').notNull(),
    unitId: text('unit_id'),
    // The establishment uid who issued an invite (null for self-arriving funnel
    // steps like a direct signup).
    actorId: text('actor_id'),
    // Set from client_profile_completed onward (the materialized Customer).
    customerId: text('customer_id'),
    // Attribution axes (PII-zero).
    intent: text('intent'),
    source: text('source'),
    medium: text('medium'),
    campaign: text('campaign'),
    // client_signed_in: did the login originate from an invite link?
    fromInvite: text('from_invite'),
    // client_profile_completed: which fields the completion step filled (names
    // only, e.g. ["whatsapp","birthDate"]) — never the values. JSONB array.
    fieldsFilled: jsonb('fields_filled'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'client_funnel_events_event_check',
      sql`${table.event} IN (
        'client_invite_issued',
        'client_invite_opened',
        'client_signed_in',
        'client_profile_completed',
        'appointment_created'
      )`,
    ),
    check(
      'client_funnel_events_intent_check',
      sql`${table.intent} IS NULL OR ${table.intent} IN ('signup', 'booking')`,
    ),
    // Funnel aggregation by org+time and by event type+time (CDP).
    index('client_funnel_events_org_id_ts_idx').on(table.orgId, table.ts),
    index('client_funnel_events_event_ts_idx').on(table.event, table.ts),
  ],
)

export type StoredClientFunnelEventRow = typeof clientFunnelEvents.$inferSelect
export type NewClientFunnelEventRow = typeof clientFunnelEvents.$inferInsert
