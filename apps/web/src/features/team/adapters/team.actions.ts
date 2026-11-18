'use server'

import {
  canInviteMembers,
  defaultPermissionsForRole,
  INVITE_TTL_MS,
  type Membership,
  membershipDocId,
  normalizeBrazilMobile,
  type Role,
  ROLES,
} from '@/domain'
import { InviteConfig, MemberOperationConfig, MembershipConfig } from '@/domain/aggregates'
import { generateInviteToken } from '@/features/invites/adapters/invite-token'
import { offboardMemberInOrg, type OffboardWarning } from '@/features/team/adapters/offboard-member'
import { assertTeamSeatQuota } from '@/features/team/adapters/team-quota'
import { buildMemberInviteWhatsapp } from '@/features/team/core/member-invite'
import { parseMemberOperationForm } from '@/features/team/core/member-operation-form'
import { getSessionUser } from '@/shared/auth/session'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { classifyError } from '@/shared/errors/classify'
import { messageForCategory } from '@/shared/errors/messages'
import { formString } from '@/shared/form-data'
import { canDeleteMemberOperation } from '@/shared/org/delete-guard'
import { type StoredInvite, writeInvitePii } from '@/shared/org/invite-read'
import {
  deleteMemberOperationPii,
  writeMemberOperationPii,
} from '@/shared/org/member-operation-read'
import {
  assertCanManage,
  getActiveOrgContext,
  getMembership,
  requireManagerCtx,
  requireOwnerCtx,
} from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { emitMemberFunnelEvent } from '@/shared/product/member-funnel-events'
import { resolveBaseUrl } from '@/shared/site-url'
import { revalidatePath } from 'next/cache'

import {
  aggregateRef,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { commitSaga } from '@/shared/effect-bridge'

import {
  resolveMemberOperatorRoleStep,
  validateServiceUnitIntersection,
} from './member-write-helpers'

export type CreateInviteResult =
  { ok: true; inviteLink: string; whatsappHref: string } | { ok: false; error: string }

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v)
}

export async function createInvite(formData: FormData): Promise<CreateInviteResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return { ok: false, error: 'No active org' }

  if (!canInviteMembers(ctx.membership.role)) {
    return { ok: false, error: 'Only owners and managers can invite' }
  }
  assertCanManage(ctx.membership)

  const quotaError = await assertTeamSeatQuota(ctx.membership.orgId)
  if (quotaError) return { ok: false, error: quotaError }

  const rawPhone = formString(formData, 'mobile')
  const role = formString(formData, 'role')

  const mobile = normalizeBrazilMobile(rawPhone)
  if (!mobile) return { ok: false, error: 'Celular inválido' }
  if (!isRole(role)) return { ok: false, error: 'Invalid role' }
  if (role === 'owner') return { ok: false, error: 'Cannot invite as owner' }

  const now = Date.now()
  const { raw, hash } = generateInviteToken()

  const inviteId = newId()
  const stored: StoredInvite = {
    id: inviteId,
    orgId: ctx.membership.orgId,
    role,
    tokenHash: hash,
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    status: 'pending',
    invitedBy: session.uid,
    acceptedByUid: null,
    acceptedAt: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
  const base = await resolveBaseUrl()

  await writeInvitePii(ctx.membership.orgId, inviteId, { mobile })
  const created = await emitEvent(
    InviteConfig,
    aggregateRef(InviteConfig, ctx.membership.orgId, stored.id),
    { _tag: 'invite.created', actorId: session.uid, payload: { data: stored } },
  )
  if (!created.ok) return { ok: false, error: created.error }

  const inviteLink = `${base}/invites/${ctx.membership.orgId}/${stored.id}?token=${raw}`

  const org = await getOrg(ctx.membership.orgId)
  const wa = buildMemberInviteWhatsapp({
    rawPhone: rawPhone,
    orgName: org?.name ?? 'Estabelecimento',
    inviteLink,
  })
  if (!wa.ok) return { ok: false, error: wa.error }

  await emitMemberFunnelEvent({
    event: 'member_invite_issued',
    orgId: ctx.membership.orgId,
    actorId: session.uid,
    role,
  })

  revalidatePath('/team')
  return { ok: true, inviteLink, whatsappHref: wa.href }
}

export type MemberOperationMutationResult = { ok: true } | { ok: false; error: string }

export async function updateMemberOperation(
  memberOperationId: string,
  formData: FormData,
): Promise<MemberOperationMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseMemberOperationForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const invariantErr = await validateServiceUnitIntersection(
    r.ctx.membership.orgId,
    parsed.catalogServiceIds,
    parsed.unitIds,
  )
  if (invariantErr) return { ok: false, error: invariantErr }

  const { taxIdentity, ...operational } = parsed
  await writeMemberOperationPii(r.ctx.membership.orgId, memberOperationId, { taxIdentity })
  const updated = await emitEvent(
    MemberOperationConfig,
    aggregateRef(MemberOperationConfig, r.ctx.membership.orgId, memberOperationId),
    {
      _tag: 'member_operation.updated',
      actorId: r.ctx.session.uid,
      payload: { changes: { ...operational } },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/team')
  return { ok: true }
}

export async function deleteMemberOperation(
  memberOperationId: string,
): Promise<MemberOperationMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  if (!(await canDeleteMemberOperation(r.ctx.membership.orgId, memberOperationId))) {
    return { ok: false, error: 'Profissional tem vínculo ativo — desative ou remova do time.' }
  }
  const deleted = await emitEvent(
    MemberOperationConfig,
    aggregateRef(MemberOperationConfig, r.ctx.membership.orgId, memberOperationId),
    { _tag: 'member_operation.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  try {
    await deleteOrgProjectionDoc(
      aggregateRef(MemberOperationConfig, r.ctx.membership.orgId, memberOperationId),
    )
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: 'Não é possível excluir este profissional: há agendamentos vinculados a ele.',
      }
    }
    return { ok: false as const, error: messageForCategory(classifyError(err)) }
  }
  await deleteMemberOperationPii(r.ctx.membership.orgId, memberOperationId)
  revalidatePath('/team')
  return { ok: true }
}

export type ChangeRoleResult = { ok: true } | { ok: false; error: string }

const ASSIGNABLE_ROLES: readonly Role[] = ['manager', 'member_operator', 'receptionist'] as const

export async function changeMemberRole(
  targetUserId: string,
  newRole: Role,
): Promise<ChangeRoleResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { orgId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    return { ok: false, error: 'Invalid target role' }
  }
  if (targetUserId === r.ctx.session.uid) {
    return { ok: false, error: 'Cannot change your own role' }
  }

  const membershipId = membershipDocId(orgId, targetUserId)
  const member = await getMembership(orgId, targetUserId)
  if (!member) return { ok: false, error: 'Member not found' }
  if (member.role === 'owner') return { ok: false, error: 'Cannot change the owner role' }
  if (member.role === newRole) return { ok: true }

  const willBeMemberOperator = newRole === 'member_operator'

  const proStep = await resolveMemberOperatorRoleStep({
    orgId,
    actorId,
    targetUserId,
    willBeMemberOperator,
  })
  const steps: SagaStep[] = [
    (tx: TransactionContext) =>
      appendEventToTx(
        MembershipConfig,
        aggregateRef(MembershipConfig, orgId, membershipId),
        {
          _tag: 'membership.updated',
          actorId,
          payload: {
            changes: { role: newRole, permissions: defaultPermissionsForRole(newRole) },
          },
        },
        tx,
      ),
  ]
  if (proStep.kind !== 'none') {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        MemberOperationConfig,
        aggregateRef(MemberOperationConfig, orgId, proStep.proId),
        proStep.input,
        tx,
      ),
    )
  }
  const outcome = await commitSaga(steps)
  if (!outcome.ok) return { ok: false, error: outcome.error }
  if (proStep.kind === 'create') {
    await writeMemberOperationPii(orgId, proStep.proId, { taxIdentity: null })
  }
  revalidatePath('/team')
  revalidatePath(`/team/${targetUserId}`)
  return { ok: true }
}

export type SetMemberStatusResult = { ok: true } | { ok: false; error: string }

export async function setMemberStatus(
  targetUserId: string,
  status: Extract<Membership['status'], 'active' | 'suspended'>,
): Promise<SetMemberStatusResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { orgId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (status !== 'active' && status !== 'suspended') {
    return { ok: false, error: 'Invalid target status' }
  }
  if (targetUserId === actorId) {
    return { ok: false, error: 'Cannot deactivate your own membership' }
  }

  const membershipId = membershipDocId(orgId, targetUserId)
  const member = await getMembership(orgId, targetUserId)
  if (!member) return { ok: false, error: 'Member not found' }
  if (member.role === 'owner') return { ok: false, error: 'Cannot deactivate the owner' }
  if (member.status === status) return { ok: true }

  const updated = await emitEvent(
    MembershipConfig,
    aggregateRef(MembershipConfig, orgId, membershipId),
    {
      _tag: 'membership.updated',
      actorId,
      payload: { changes: { status } },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/team')
  revalidatePath(`/team/${targetUserId}`)
  return { ok: true }
}

export type RemoveMemberResult =
  { ok: true; warnings: OffboardWarning[] } | { ok: false; error: string }

export async function removeMemberFromTeam(targetUserId: string): Promise<RemoveMemberResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { orgId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (targetUserId === actorId) {
    return { ok: false, error: 'Cannot remove yourself from the team' }
  }

  const result = await offboardMemberInOrg(orgId, targetUserId, actorId)
  if (!result.ok) return result

  if (result.warnings.length === 0) {
    revalidatePath('/team')
    revalidatePath(`/team/${targetUserId}`)
  }
  return { ok: true, warnings: result.warnings }
}

export type SaveMemberResult = { ok: true } | { ok: false; error: string }

export async function saveMemberDetail(input: {
  targetUserId: string
  currentRole: Role
  newRole: Role
  memberOperationId: string | null
  formData: FormData | null
}): Promise<SaveMemberResult> {
  const { targetUserId, currentRole, newRole, memberOperationId, formData } = input

  if (newRole !== currentRole) {
    const roleResult = await changeMemberRole(targetUserId, newRole)
    if (!roleResult.ok) return roleResult
  }

  const staysMemberOperator = newRole === 'member_operator' && currentRole === 'member_operator'
  if (staysMemberOperator && memberOperationId && formData) {
    const opResult = await updateMemberOperation(memberOperationId, formData)
    if (!opResult.ok) return opResult
  }

  return { ok: true }
}
