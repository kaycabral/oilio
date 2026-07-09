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

  const invite = await getInviteById(orgId, inviteId)
  if (!invite) return { ok: false, error: 'Invite not found' }
  if (invite.status !== 'pending') return { ok: false, error: 'Invite already used' }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    const flagged = await emitEvent(InviteConfig, aggregateRef(InviteConfig, orgId, inviteId), {
      _tag: 'invite.updated',
      actorId: session.uid,
      payload: { changes: { status: 'expired' } },
    })
    if (!flagged.ok) {
      logger.warn('failed to flag expired invite', { scope: 'acceptInvite', orgId, inviteId })
    }
    return { ok: false, error: 'Invite expired' }
  }
  if (!verifyInviteToken(token, invite.tokenHash)) {
    return { ok: false, error: 'Invalid invite token' }
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
  await emitMemberFunnelEvent({
    event: 'member_invite_accepted',
    orgId,
    memberUid: actorUid,
    role: membership.role,
  })
  redirect(canManageOrg(membership.role) ? '/dashboard' : '/agenda')
}
