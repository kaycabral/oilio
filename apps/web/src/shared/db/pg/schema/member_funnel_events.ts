import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The append-only `member_funnel_events` telemetry log (brief 0084, Grupo D —
 * AC-11). The team-onboarding funnel: invite issued → opened → accepted. Mirrors
 * `client_funnel_events` (brief 0077) but for the MEMBER invite: it carries the
 * proposed `role`, not customer attribution — a member invite grants a role, not
 * a customer-acquisition touch.
 *
 * PII-ZERO by construction (the parede PII↔analytics): every column is an opaque
 * id (org/actor/member) or the role enum — NEVER a name, phone or email. The
 * invitee's mobile lives only on the apagável `invites_pii` sidecar; the funnel
 * reasons over references. This is the transport described by brief 0026's
 * vendor-neutral `track()`: an append-only table now, one adapter behind `track()`
 * when that layer ships — call-sites depend only on `emitMemberFunnelEvent`.
 *
 * INSERT-only (telemetry is never updated/deleted). Columns are the UNION of the
 * three event payloads; irrelevant ones are NULL per event (e.g. `member_uid` is
 * only set on `member_invite_accepted`).
 *
 * NO Row-Level Security: analytics read by the CDP/aggregation layer across orgs,
 * never by an org-scoped product query. `org_id` is an attribution dimension.
 *
 * Invariants enforced HERE:
 *   - `event ∈ {member_invite_issued, member_invite_opened, member_invite_accepted}` — CHECK.
 *   - `role ∈ {owner, manager, member_operator, receptionist}` when present — CHECK.
 *   - `org_id` + `ts` NOT NULL.
 */
export const memberFunnelEvents = pgTable(
  'member_funnel_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    // Attribution dimension (not an isolation boundary — see header).
    orgId: text('org_id').notNull(),
    // The establishment uid who issued the invite (set on issued/accepted).
    actorId: text('actor_id'),
    // The uid that accepted (set on member_invite_accepted only — first-accept).
    memberUid: text('member_uid'),
    // The proposed role of the invite.
    role: text('role'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'member_funnel_events_event_check',
      sql`${table.event} IN (
        'member_invite_issued',
        'member_invite_opened',
        'member_invite_accepted'
      )`,
    ),
    check(
      'member_funnel_events_role_check',
      sql`${table.role} IS NULL OR ${table.role} IN ('owner', 'manager', 'member_operator', 'receptionist')`,
    ),
    // Funnel aggregation by org+time and by event type+time (CDP).
    index('member_funnel_events_org_id_ts_idx').on(table.orgId, table.ts),
    index('member_funnel_events_event_ts_idx').on(table.event, table.ts),
  ],
)

export type StoredMemberFunnelEventRow = typeof memberFunnelEvents.$inferSelect
export type NewMemberFunnelEventRow = typeof memberFunnelEvents.$inferInsert
