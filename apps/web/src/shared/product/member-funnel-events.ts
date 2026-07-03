import type { Role } from '@/domain'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger } from '@/shared/lib/logger'
import 'server-only'

// Team-onboarding funnel telemetry — brief 0084 Grupo D (AC-11). The funnel:
// invite issued → opened → accepted. Mirrors `client-funnel-events.ts` (brief
// 0077) but for the MEMBER invite: it carries the proposed `role`, not customer
// attribution.
//
// PII-ZERO by construction (the parede PII↔analytics): every property is an
// opaque id (org/actor/member) or the role enum — never a name/phone/email. The
// invitee's WhatsApp lives only on the apagável `invites_pii` sidecar. This is
// the transport brief 0026's vendor-neutral `track()` describes — an append-only
// table now, one adapter behind `track()` later.
//
// Best-effort: telemetry must NEVER trap the funnel action (mirrors
// `emitClientFunnelEvent`) — a write failure is logged and swallowed.

export type MemberFunnelEventName =
  | 'member_invite_issued'
  | 'member_invite_opened'
  | 'member_invite_accepted'

export type MemberInviteIssuedPayload = {
  readonly orgId: string
  readonly actorId: string
  readonly role: Role
}

export type MemberInviteOpenedPayload = {
  readonly orgId: string
}

export type MemberInviteAcceptedPayload = {
  readonly orgId: string
  readonly memberUid: string
  readonly role: Role
}

type MemberFunnelEventPayload =
  | ({ event: 'member_invite_issued' } & MemberInviteIssuedPayload)
  | ({ event: 'member_invite_opened' } & MemberInviteOpenedPayload)
  | ({ event: 'member_invite_accepted' } & MemberInviteAcceptedPayload)

type FunnelColumns = {
  orgId: string
  actorId: string | null
  memberUid: string | null
  role: string | null
}

function columnsFor(event: MemberFunnelEventPayload): FunnelColumns {
  const base: FunnelColumns = {
    orgId: event.orgId,
    actorId: null,
    memberUid: null,
    role: null,
  }
  switch (event.event) {
    case 'member_invite_issued':
      return { ...base, actorId: event.actorId, role: event.role }
    case 'member_invite_opened':
      return base
    case 'member_invite_accepted':
      return { ...base, memberUid: event.memberUid, role: event.role }
  }
}

// Emit a member-funnel event. Server-only; best-effort — a failure must not
// bubble into the funnel action (the invite/accept never breaks on telemetry).
export async function emitMemberFunnelEvent(event: MemberFunnelEventPayload): Promise<void> {
  const c = columnsFor(event)
  try {
    await getEventStorePool().query(
      `INSERT INTO member_funnel_events (event, org_id, actor_id, member_uid, role, ts)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.event, c.orgId, c.actorId, c.memberUid, c.role, new Date().toISOString()],
    )
  } catch (err) {
    logger.error('failed to record member funnel event', {
      scope: 'emitMemberFunnelEvent',
      event: event.event,
      err,
    })
  }
}
