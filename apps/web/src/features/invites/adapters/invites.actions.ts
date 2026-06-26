'use server'

import {
  defaultPermissionsForRole,
  inviteEmailsMatch,
  type Membership,
  membershipDocId,
} from '@/domain'
import { InviteConfig, MembershipConfig, ProfessionalConfig } from '@/domain/aggregates'
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
import { getInviteById } from '@/shared/org/invite-read'
import { type StoredProfessional, writeProfessionalPii } from '@/shared/org/professional-read'
import { redirect } from 'next/navigation'

export type AcceptInviteResult = { ok: true; orgId: string } | { ok: false; error: string }

// Identity-pure saga (membership + professional + invite + `users.current_org_id`):
// membership + professional (if any) + invite.accepted commit together or ROLLBACK
// as one ACID transaction (#1199 — no manual compensation). The `professionals_pii`
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

  // PII (invitee email) merged from `invites_pii` on read (#1036) — the email
  // match below needs it.
  const invite = await getInviteById(orgId, inviteId)
  if (!invite) return { ok: false, error: 'Invite not found' }
  if (invite.status !== 'pending') return { ok: false, error: 'Invite already used' }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    // Event-first: a projeção do convite expirado vem do evento.
    await emitEvent(InviteConfig, aggregateRef(InviteConfig, orgId, inviteId), {
      _tag: 'invite.updated',
      actorId: session.uid,
      payload: { changes: { status: 'expired' } },
    })
    return { ok: false, error: 'Invite expired' }
  }
  if (!verifyInviteToken(token, invite.tokenHash)) {
    return { ok: false, error: 'Invalid invite token' }
  }
  // Strict email match (#827): OAuth identity email must equal the invite
  // email after trim + lowercase. Anything else is a security regression.
  if (!session.email || !inviteEmailsMatch(session.email, invite.email)) {
    return {
      ok: false,
      error: `Use a conta do email ${invite.email}. A conta logada é ${session.email ?? '(sem email)'}.`,
    }
  }

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

  // The professional projection (only for role=professional). The id is minted
  // backend-agnostically (cutover — `newId()`, brief 0062). PII (`taxIdentity`)
  // never enters the event payload (LGPD — ADR 0010); it lands in the
  // `professionals_pii` sidecar, written post-commit (non-aggregate).
  const proId = invite.role === 'professional' ? newId() : null
  const storedPro: StoredProfessional | null =
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
  storedPro: StoredProfessional | null
}

// Accept path (#1199): membership + professional (if any) + invite.accepted
// commit together or ROLLBACK as one ACID transaction — no manual compensation.
// The `professionals_pii` sidecar + the `users.current_org_id` auth row are
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
        ProfessionalConfig,
        aggregateRef(ProfessionalConfig, orgId, proId),
        {
          _tag: 'professional.created',
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

  if (proId) await writeProfessionalPii(orgId, proId, { taxIdentity: null })
  await patchUser(actorUid, { current_org_id: inviteOrgId }, now)
  redirect('/dashboard')
}
