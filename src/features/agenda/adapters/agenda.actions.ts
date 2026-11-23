'use server'

import {
  resolveCatalogItemForUnit,
  unitCancellationPolicySnapshot,
  type Appointment,
  type Membership,
} from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  decideSnapshotRefresh,
  validateEditableCustomer,
} from '@/features/agenda/core/appointment-edit'
import {
  parseAppointmentForm,
  readAppointmentId,
  resolveStartEnd,
} from '@/features/agenda/core/appointment-form'
import {
  decideCancel,
  decideNoShow,
  decideUnmarkNoShow,
} from '@/features/agenda/core/appointment-transitions'
import { commitAppointmentBooking } from '@/features/booking/adapters/commit-appointment'
import { revalidatePath } from 'next/cache'

import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'

import { getAppointmentById } from '@/shared/org/appointment-read'
import { resolveWriteSecurity } from '@/shared/org/member-operation-read'
import { canActOnOwnedResource, requireOrgCtx } from '@/shared/org/membership'
import { getUnitById } from '@/shared/org/unit-read'
import {
  guardCustomerNotBlocked,
  loadActiveCatalogService,
  loadApprovedMemberOperation,
  persistAppointmentUpdate,
  resolveAppointmentCustomerId,
  type AppointmentMutationResult,
} from './appointment-write-helpers'
import { validateAppointmentWrite } from './validate-appointment-write'

function ensureCanActOnAppointment(
  membership: Membership,
  appointment: Appointment,
): AppointmentMutationResult | null {
  if (canActOnOwnedResource(membership, appointment.memberOperatorUserId ?? '')) return null
  return { ok: false, error: 'Você só pode alterar os próprios agendamentos' }
}

function resolveBookableError(
  membership: Membership,
  memberOperation: { userId: string } | string,
): AppointmentMutationResult | null {
  if (typeof memberOperation === 'string') return { ok: false, error: memberOperation }
  if (!canActOnOwnedResource(membership, memberOperation.userId)) {
    return { ok: false, error: 'Você só pode agendar para si mesmo' }
  }
  return null
}

export async function cancelAppointment(appointmentId: string): Promise<AppointmentMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const existing = await getAppointmentById(r.ctx.membership.orgId, appointmentId)
  if (!existing) return { ok: false, error: 'Agendamento não encontrado' }
  {
    const denied = ensureCanActOnAppointment(r.ctx.membership, existing)
    if (denied) return denied
  }

  const decision = decideCancel(existing, 'staff', new Date().toISOString())
  if (!decision.ok) return { ok: false, error: decision.error }

  const security = await resolveWriteSecurity(r.ctx.membership, existing.unitId)
  const cancelled = await emitEvent(
    AppointmentConfig,
    aggregateRef(AppointmentConfig, r.ctx.membership.orgId, appointmentId),
    {
      _tag: 'appointment.cancelled',
      actorId: r.ctx.session.uid,
      payload: {
        cancelledBy: decision.value.cancelledBy,
        cancelledAt: decision.value.cancelledAt,
        noticeMinutes: decision.value.noticeMinutes,
      },
    },
    security,
  )
  if (!cancelled.ok) return { ok: false, error: cancelled.error }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

export async function markAppointmentNoShow(
  appointmentId: string,
): Promise<AppointmentMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const existing = await getAppointmentById(r.ctx.membership.orgId, appointmentId)
  if (!existing) return { ok: false, error: 'Agendamento não encontrado' }
  {
    const denied = ensureCanActOnAppointment(r.ctx.membership, existing)
    if (denied) return denied
  }

  const now = new Date()
  const decision = decideNoShow(existing, now)
  if (!decision.ok) return { ok: false, error: decision.error }

  const nowIso = now.toISOString()
  const security = await resolveWriteSecurity(r.ctx.membership, existing.unitId)
  const marked = await emitEvent(
    AppointmentConfig,
    aggregateRef(AppointmentConfig, r.ctx.membership.orgId, appointmentId),
    {
      _tag: 'appointment.no_show',
      actorId: r.ctx.session.uid,
      payload: {
        markedAt: nowIso,
        markedBy: r.ctx.session.uid,
      },
    },
    security,
  )
  if (!marked.ok) return { ok: false, error: marked.error }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

export async function unmarkAppointmentNoShow(
  appointmentId: string,
): Promise<AppointmentMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const existing = await getAppointmentById(r.ctx.membership.orgId, appointmentId)
  if (!existing) return { ok: false, error: 'Agendamento não encontrado' }
  {
    const denied = ensureCanActOnAppointment(r.ctx.membership, existing)
    if (denied) return denied
  }

  const decision = decideUnmarkNoShow(existing)
  if (!decision.ok) return { ok: false, error: decision.error }

  const security = await resolveWriteSecurity(r.ctx.membership, existing.unitId)
  const reverted = await emitEvent(
    AppointmentConfig,
    aggregateRef(AppointmentConfig, r.ctx.membership.orgId, appointmentId),
    { _tag: 'appointment.no_show_reverted', actorId: r.ctx.session.uid, payload: {} },
    security,
  )
  if (!reverted.ok) return { ok: false, error: reverted.error }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

export async function updateAppointment(
  appointmentId: string,
  formData: FormData,
): Promise<AppointmentMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const parsed = parseAppointmentForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const unit = await getUnitById(r.ctx.membership.orgId, parsed.unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }

  const editable = validateEditableCustomer(parsed)
  if (!editable.ok) return { ok: false, error: editable.error }
  const customerId = editable.value.customerId

  const editGuard = await guardCustomerNotBlocked(r.ctx.membership.orgId, customerId)
  if (editGuard) return editGuard

  const previous = await getAppointmentById(r.ctx.membership.orgId, appointmentId)
  if (!previous) return { ok: false, error: 'Agendamento não encontrado' }
  {
    const denied = ensureCanActOnAppointment(r.ctx.membership, previous)
    if (denied) return denied
  }

  const [item, memberOperation] = await Promise.all([
    loadActiveCatalogService(r.ctx.membership.orgId, parsed.serviceId),
    loadApprovedMemberOperation(r.ctx.membership.orgId, parsed.memberOperationId),
  ])
  if (typeof item === 'string') return { ok: false, error: item }
  if (typeof memberOperation === 'string') return { ok: false, error: memberOperation }

  const resolved = resolveCatalogItemForUnit(item, parsed.unitId)
  const { serviceOrUnitChanged, effectiveDurationMinutes } = decideSnapshotRefresh({
    parsed,
    previous,
    resolvedDurationMinutes: resolved.durationMinutes,
  })

  const times = resolveStartEnd({ timezone: unit.timezone }, parsed, effectiveDurationMinutes)
  if (typeof times === 'string') return { ok: false, error: times }
  const { startAt, endAt } = times

  const validation = await validateAppointmentWrite({
    orgId: r.ctx.membership.orgId,
    unit,
    userId: r.ctx.session.uid,
    surface: 'reception',
    parsed,
    startAt,
    endAt,
    customerId,
    serviceCategoryId: item.categoryId,
    excludeAppointmentId: appointmentId,
  })
  if (!validation.ok) {
    return { ok: false, error: validation.error, conflicts: validation.conflicts }
  }

  const security = await resolveWriteSecurity(r.ctx.membership, parsed.unitId)

  return persistAppointmentUpdate({
    orgId: r.ctx.membership.orgId,
    actorUid: r.ctx.session.uid,
    appointmentId,
    parsed: { ...parsed, customerId },
    previous,
    startAt,
    endAt,
    resolved,
    serviceOrUnitChanged,
    security,
  })
}

export async function createAppointment(formData: FormData): Promise<AppointmentMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const parsed = parseAppointmentForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const unit = await getUnitById(r.ctx.membership.orgId, parsed.unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }

  const [item, memberOperation] = await Promise.all([
    loadActiveCatalogService(r.ctx.membership.orgId, parsed.serviceId),
    loadApprovedMemberOperation(r.ctx.membership.orgId, parsed.memberOperationId),
  ])
  if (typeof item === 'string') return { ok: false, error: item }
  const bookableError = resolveBookableError(r.ctx.membership, memberOperation)
  if (bookableError) return bookableError

  const resolved = resolveCatalogItemForUnit(item, parsed.unitId)

  const times = resolveStartEnd({ timezone: unit.timezone }, parsed, resolved.durationMinutes)
  if (typeof times === 'string') return { ok: false, error: times }
  const { startAt, endAt } = times

  const resolvedCustomer = await resolveAppointmentCustomerId(r.ctx.membership, parsed)
  if (!resolvedCustomer.ok) return resolvedCustomer
  const customerId = resolvedCustomer.customerId

  const createGuard = await guardCustomerNotBlocked(r.ctx.membership.orgId, customerId)
  if (createGuard) return createGuard

  const validation = await validateAppointmentWrite({
    orgId: r.ctx.membership.orgId,
    unit,
    userId: r.ctx.session.uid,
    surface: 'reception',
    parsed,
    startAt,
    endAt,
    customerId,
    serviceCategoryId: item.categoryId,
  })
  if (!validation.ok) {
    return { ok: false, error: validation.error, conflicts: validation.conflicts }
  }

  const userIds = await resolveAppointmentUserIds(
    r.ctx.membership.orgId,
    customerId,
    parsed.memberOperationId,
  )
  if (!userIds.ok) return userIds

  const appointmentId = newId()
  const now = new Date().toISOString()
  const appointment: Appointment = {
    id: appointmentId,
    orgId: r.ctx.membership.orgId,
    unitId: parsed.unitId,
    memberOperationId: parsed.memberOperationId,
    customerId,
    serviceId: parsed.serviceId,
    startAt,
    endAt,
    status: 'scheduled',
    servicePriceCentsSnapshot: resolved.priceCents,
    serviceDurationMinutesSnapshot: resolved.durationMinutes,
    commissionSnapshot: resolved.commission,
    cancellationPolicySnapshot: unitCancellationPolicySnapshot(unit.agenda),
    customerUserId: userIds.ids.customerUserId,
    memberOperatorUserId: userIds.ids.memberOperatorUserId,
    attribution: null,
    createdAt: now,
    updatedAt: now,
  }

  const security = await resolveWriteSecurity(r.ctx.membership, parsed.unitId)

  const commit = await commitAppointmentBooking({
    orgId: r.ctx.membership.orgId,
    appointment,
    actorUid: r.ctx.session.uid,
    via: 'internal_panel',
    security,
  })
  if (!commit.ok) {
    return {
      ok: false,
      error:
        'O profissional já tem um atendimento nesse horário (pode ser em outra unidade). Recarregue a agenda e escolha outro.',
      conflicts: ['agendamento existente'],
    }
  }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

export type AppointmentFormActionState = { ok: boolean; error?: string }

export async function cancelAppointmentFormAction(
  _prev: AppointmentFormActionState,
  formData: FormData,
): Promise<AppointmentFormActionState> {
  const id = readAppointmentId(formData)
  if (!id) return { ok: false, error: 'Agendamento não informado' }
  const res = await cancelAppointment(id)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

export async function markAppointmentNoShowFormAction(
  _prev: AppointmentFormActionState,
  formData: FormData,
): Promise<AppointmentFormActionState> {
  const id = readAppointmentId(formData)
  if (!id) return { ok: false, error: 'Agendamento não informado' }
  const res = await markAppointmentNoShow(id)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

export async function unmarkAppointmentNoShowFormAction(
  _prev: AppointmentFormActionState,
  formData: FormData,
): Promise<AppointmentFormActionState> {
  const id = readAppointmentId(formData)
  if (!id) return { ok: false, error: 'Agendamento não informado' }
  const res = await unmarkAppointmentNoShow(id)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
