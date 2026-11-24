import { type Membership, membershipDocId } from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  InviteConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import {
  aggregateRef,
  appendDeleteToTx,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { loadOpenOrdersForOrg } from '@/features/orders/adapters/order-financial-read'
import { getUserById } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { listAgendaBlocksByMemberOperationId } from '@/shared/org/agenda-block-read'
import { listAppointmentsByMemberOperationId } from '@/shared/org/appointment-read'
import { deleteInvitePii, listInvitesByStatus } from '@/shared/org/invite-read'
import {
  getMemberOperationByUserId,
  listMemberOperationsForOrg,
} from '@/shared/org/member-operation-read'
import { getMembership } from '@/shared/org/membership'
import { normalizeBrazilPhone } from '@cbrl/br/phone'
import 'server-only'

export type OffboardWarning = { kind: 'unit-without-memberOperation'; unitIds: string[] }

export type OffboardResult =
  { ok: true; warnings: OffboardWarning[] } | { ok: false; error: string }

async function findOpenComanda(orgId: string, targetUserId: string): Promise<string | null> {
  const openOrders = await loadOpenOrdersForOrg(orgId)
  for (const order of openOrders) {
    if (order.items.some((item) => item.attributedUserId === targetUserId)) return order.id
  }
  return null
}

async function resolveFutureAppointmentCancels(
  orgId: string,
  memberOperationId: string,
): Promise<{ id: string; cancelledAt: string; noticeMinutes: number }[]> {
  const appts = await listAppointmentsByMemberOperationId(orgId, memberOperationId)
  const nowMs = Date.now()
  const now = new Date().toISOString()
  const cancels: { id: string; cancelledAt: string; noticeMinutes: number }[] = []
  for (const appt of appts) {
    if (appt.status !== 'scheduled') continue
    if (new Date(appt.startAt).getTime() <= nowMs) continue
    const noticeMinutes = Math.max(
      0,
      Math.round((new Date(appt.startAt).getTime() - nowMs) / 60000),
    )
    cancels.push({ id: appt.id, cancelledAt: now, noticeMinutes })
  }
  return cancels
}

async function detectUnitsLeftWithoutMemberOperation(
  orgId: string,
  removedMemberOperationId: string,
  removedUnitIds: readonly string[],
): Promise<string[]> {
  if (removedUnitIds.length === 0) return []
  const memberOperations = await listMemberOperationsForOrg(orgId)
  const stillStaffed = new Set<string>()
  for (const pro of memberOperations) {
    if (pro.id === removedMemberOperationId) continue
    if (pro.operationalStatus !== 'operational') continue
    for (const unitId of pro.unitIds ?? []) stillStaffed.add(unitId)
  }
  return [...new Set(removedUnitIds)].filter((unitId) => !stillStaffed.has(unitId)).sort()
}

export type ResolvedOffboard = {
  membershipId: string
  previousStatus: Membership['status']
  memberOperationId: string | null
  appointmentCancels: { id: string; cancelledAt: string; noticeMinutes: number }[]
  agendaBlockIds: string[]
  inviteIds: string[]
}

async function resolveMemberWhatsapp(targetUserId: string): Promise<string | null> {
  const user = await getUserById(targetUserId)
  const raw = user?.mobile ?? null
  return raw ? normalizeBrazilPhone(raw) : null
}

export function buildOffboardSteps(
  resolved: ResolvedOffboard,
  orgId: string,
  actorId: string,
): SagaStep[] {
  const steps: SagaStep[] = []

  steps.push((tx: TransactionContext) =>
    appendEventToTx(
      MembershipConfig,
      aggregateRef(MembershipConfig, orgId, resolved.membershipId),
      {
        _tag: 'membership.updated',
        actorId,
        payload: { changes: { status: 'revoked' } },
      },
      tx,
    ),
  )

  for (const cancel of resolved.appointmentCancels) {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        AppointmentConfig,
        aggregateRef(AppointmentConfig, orgId, cancel.id),
        {
          _tag: 'appointment.cancelled',
          actorId,
          payload: {
            cancelledBy: 'system',
            cancelledAt: cancel.cancelledAt,
            noticeMinutes: cancel.noticeMinutes,
          },
        },
        tx,
      ),
    )
  }

  for (const blockId of resolved.agendaBlockIds) {
    steps.push((tx: TransactionContext) =>
      appendDeleteToTx(
        AgendaBlockConfig,
        aggregateRef(AgendaBlockConfig, orgId, blockId),
        {
          _tag: 'agenda_block.deleted',
          actorId,
          payload: {},
        },
        tx,
      ),
    )
  }

  for (const inviteId of resolved.inviteIds) {
    steps.push((tx: TransactionContext) =>
      appendDeleteToTx(
        InviteConfig,
        aggregateRef(InviteConfig, orgId, inviteId),
        {
          _tag: 'invite.deleted',
          actorId,
          payload: {},
        },
        tx,
      ),
    )
  }

  return steps
}

async function offboardMemberPostgres(args: {
  orgId: string
  targetUserId: string
  actorId: string
  previousStatus: Membership['status']
  existingPro: { id: string; unitIds?: readonly string[] } | null
}): Promise<{ ok: true; removedUnitIds: readonly string[] } | { ok: false; error: string }> {
  const { orgId, targetUserId, actorId, previousStatus, existingPro } = args
  const membershipId = membershipDocId(orgId, targetUserId)
  const memberOperationId = existingPro?.id ?? null
  const removedUnitIds = existingPro ? (existingPro.unitIds ?? []) : []

  const appointmentCancels = memberOperationId
    ? await resolveFutureAppointmentCancels(orgId, memberOperationId)
    : []
  const agendaBlocks = memberOperationId
    ? await listAgendaBlocksByMemberOperationId(orgId, memberOperationId)
    : []
  const whatsapp = await resolveMemberWhatsapp(targetUserId)
  const pendingInvites = whatsapp
    ? (await listInvitesByStatus(orgId, 'pending')).filter(
        (invite) => invite.mobile && normalizeBrazilPhone(invite.mobile) === whatsapp,
      )
    : []

  const resolved: ResolvedOffboard = {
    membershipId,
    previousStatus,
    memberOperationId,
    appointmentCancels,
    agendaBlockIds: agendaBlocks.map((b) => b.id),
    inviteIds: pendingInvites.map((i) => i.id),
  }

  const outcome = await commitSaga(buildOffboardSteps(resolved, orgId, actorId))
  if (!outcome.ok) return { ok: false, error: outcome.error }

  for (const inviteId of resolved.inviteIds) {
    await deleteInvitePii(orgId, inviteId)
  }

  return { ok: true, removedUnitIds }
}

export async function offboardMemberInOrg(
  orgId: string,
  targetUserId: string,
  actorId: string,
): Promise<OffboardResult> {
  const member = await getMembership(orgId, targetUserId)
  if (!member) return { ok: false, error: 'Member not found' }
  if (member.role === 'owner') return { ok: false, error: 'Cannot remove the owner' }
  if (member.status === 'revoked') return { ok: true, warnings: [] }

  const openComanda = await findOpenComanda(orgId, targetUserId)
  if (openComanda) {
    return {
      ok: false,
      error: 'Feche ou cancele a comanda aberta deste profissional antes de removê-lo.',
    }
  }

  const previousStatus = member.status

  const existingPro = await getMemberOperationByUserId(orgId, targetUserId)
  const result = await offboardMemberPostgres({
    orgId,
    targetUserId,
    actorId,
    previousStatus,
    existingPro,
  })
  if (!result.ok) return { ok: false, error: result.error }
  const unitsWithoutMemberOperation = existingPro
    ? await detectUnitsLeftWithoutMemberOperation(orgId, existingPro.id, result.removedUnitIds)
    : []
  const warnings: OffboardWarning[] =
    unitsWithoutMemberOperation.length > 0
      ? [{ kind: 'unit-without-memberOperation', unitIds: unitsWithoutMemberOperation }]
      : []
  return { ok: true, warnings }
}
