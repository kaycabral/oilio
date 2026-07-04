'use server'

import { canManageOrg, defaultPermissionsForRole, type Membership, membershipDocId } from '@/domain'
import { InviteConfig, MemberOperationConfig, MembershipConfig } from '@/domain/aggregates'
import {
  aggregateRef,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { verifyInviteToken } from '@/features/invites/adapters/invite-token'
import { newId } from '@/shared/db/pg/new-id'
import { patchUser } from '@/shared/db/pg/users-store'
import { commitSaga, emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { logger } from '@/shared/lib/logger'
import { getInviteById } from '@/shared/org/invite-read'
import {
  type StoredMemberOperation,
  writeMemberOperationPii,
} from '@/shared/org/member-operation-read'
import { emitMemberFunnelEvent } from '@/shared/product/member-funnel-events'
import { redirect } from 'next/navigation'

export type AcceptInviteResult = { ok: true; orgId: string } | { ok: false; error: string }

// Identity-pure saga (membership + memberOperation + invite + `users.current_org_id`):
// membership + memberOperation (if any) + invite.accepted commit together or ROLLBACK
// as one ACID transaction (#1199 — no manual compensation). The `member_operations_pii`
// sidecar + the `users` auth row are non-aggregate writes that can't ride the
// event-store tx, so they land AFTER the tx commits (idempotent).
export async function acceptInvite(formData: FormData): Promise<AcceptInviteResult> {
  const inviteId = formString(formData, 'inviteId')
  const token = formString(formData, 'token')
  const orgId = formString(formData, 'orgId')
  if (!inviteId || !token || !orgId) {
    return { ok: false, error: 'Missing invite parameters' }
  }

  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sign in first' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  // Read the invite (PII WhatsApp merged from `invites_pii` on read, #1036 —
  // not used at accept time; the accept binds by token + first-accept, not by
  // contact, brief 0084).
  const invite = await getInviteById(orgId, inviteId)
  if (!invite) return { ok: false, error: 'Invite not found' }
  if (invite.status !== 'pending') return { ok: false, error: 'Invite already used' }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    // Event-first: a projeção do convite expirado vem do evento.
    const flagged = await emitEvent(InviteConfig, aggregateRef(InviteConfig, orgId, inviteId), {
      _tag: 'invite.updated',
      actorId: session.uid,
      payload: { changes: { status: 'expired' } },
    })
    // The user's outcome is "expired" regardless; but with the DB-defect net
    // (#1344) a failed flag-write now returns `{ok:false}` instead of throwing —
    // log it so a swallowed defect isn't a silent lost write (the invite stays
    // un-flagged; next accept re-hits this same branch, so it self-heals).
    if (!flagged.ok) {
      logger.warn('failed to flag expired invite', { scope: 'acceptInvite', orgId, inviteId })
    }
    return { ok: false, error: 'Invite expired' }
  }
  if (!verifyInviteToken(token, invite.tokenHash)) {
    return { ok: false, error: 'Invalid invite token' }
  }
  // First-accept-wins (brief 0084): the invite grants a role, so the signed
  // token above is the access barrier — but there is NO email match (#827 is
  // gone). Google login yields an email, not a verified phone, so the invite
  // can't bind to the typed WhatsApp. The first authenticated account that
  // presents a valid token claims it: the saga stamps `acceptedByUid` +
  // `status: accepted` write-once (the `invites_acceptance_consistency` CHECK
  // guarantees a pending invite has no accepter), so a second accept of the same
  // link fails the pending guard above. `emailVerified` still gates (checked
  // earlier) — that's account hygiene, orthogonal to the invite identity.

  const now = new Date().toISOString()
  const membershipId = membershipDocId(invite.orgId, session.uid)
  const membership: Membership = {
    id: membershipId,
    orgId: invite.orgId,
    userId: session.uid,
    role: invite.role,
    status: 'active',
    invitedBy: invite.invitedBy,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole(invite.role),
  }

  // The memberOperation projection (only for role=memberOperation). The id is minted
  // backend-agnostically (cutover — `newId()`, brief 0062). PII (`taxIdentity`)
  // never enters the event payload (LGPD — ADR 0010); it lands in the
  // `member_operations_pii` sidecar, written post-commit (non-aggregate).
  const proId = invite.role === 'member_operator' ? newId() : null
  const storedPro: StoredMemberOperation | null =
    proId === null
      ? null
      : {
          id: proId,
          orgId,
          userId: session.uid,
          defaultCommission: null,
          unitIds: [],
          catalogServiceIds: [],
          createdAt: now,
          updatedAt: now,
        }

  return acceptInviteSaga({
    orgId,
    inviteOrgId: invite.orgId,
    inviteId,
    actorUid: session.uid,
    membershipId,
    membership,
    now,
    proId,
    storedPro,
  })
}

type AcceptInviteSagaArgs = {
  orgId: string
  inviteOrgId: string
  inviteId: string
  actorUid: string
  membershipId: string
  membership: Membership
  now: string
  proId: string | null
  storedPro: StoredMemberOperation | null
}

// Accept path (#1199): membership + memberOperation (if any) + invite.accepted
// commit together or ROLLBACK as one ACID transaction — no manual compensation.
// The `member_operations_pii` sidecar + the `users.current_org_id` auth row are
// non-aggregate writes that land AFTER the tx commits.
async function acceptInviteSaga(args: AcceptInviteSagaArgs): Promise<AcceptInviteResult> {
  const { orgId, inviteOrgId, inviteId, actorUid, membershipId, membership, now } = args
  const { proId, storedPro } = args

  const steps: SagaStep[] = [
    (tx: TransactionContext) =>
      appendEventToTx(
        MembershipConfig,
        aggregateRef(MembershipConfig, membership.orgId, membershipId),
        {
          _tag: 'membership.created',
          actorId: actorUid,
          payload: { data: membership },
        },
        tx,
      ),
  ]
  if (proId && storedPro) {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        MemberOperationConfig,
        aggregateRef(MemberOperationConfig, orgId, proId),
        {
          _tag: 'member_operation.created',
          actorId: actorUid,
          payload: { data: storedPro },
        },
        tx,
      ),
    )
  }
  steps.push((tx: TransactionContext) =>
    appendEventToTx(
      InviteConfig,
      aggregateRef(InviteConfig, orgId, inviteId),
      {
        _tag: 'invite.updated',
        actorId: actorUid,
        payload: { changes: { status: 'accepted', acceptedByUid: actorUid, acceptedAt: now } },
      },
      tx,
    ),
  )
  const outcome = await commitSaga(steps)
  if (!outcome.ok) return { ok: false, error: outcome.error }

  if (proId) await writeMemberOperationPii(orgId, proId, { taxIdentity: null })
  await patchUser(actorUid, { current_org_id: inviteOrgId }, now)
  // Funnel telemetry (brief 0084, Grupo D) — PII-zero, best-effort. Before the
  // redirect (which throws) so it still records on the happy path.
  await emitMemberFunnelEvent({
    event: 'member_invite_accepted',
    orgId,
    memberUid: actorUid,
    role: membership.role,
  })
  // Land on a surface the new member can actually see: the Dashboard is
  // manager-only (server-side wall on `/dashboard`), so a memberOperation/
  // receptionist must go to `/agenda` — mirrors `requireManagerPage`'s
  // `notManagerTo` default. Sending a non-manager to `/dashboard` would just
  // bounce them again.
  redirect(canManageOrg(membership.role) ? '/dashboard' : '/agenda')
}
