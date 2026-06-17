'use server'

import {
  Appointment,
  isValidSlotMinutes,
  normalizeCancellationPolicy,
  resolveCatalogItemForUnit,
} from '@/domain'
import { AppointmentConfig, TenantConfig } from '@/domain/aggregates'
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
import { enforceSubscriptionScope } from '@/features/booking/adapters/enforce-subscription-scope'
import { getAdminFirestore } from '@/shared/db'
import { revalidatePath } from 'next/cache'

import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'

import { upsertCustomerWithUser } from '@/shared/tenant/customer-upsert'
import { requireManagerCtx, requireTenantCtx } from '@/shared/tenant/membership'
import { getTenant } from '@/shared/tenant/tenant'
import {
  checkSlotConflicts,
  guardCustomerNotBlocked,
  loadActiveService,
  loadApprovedProfessional,
  persistAppointmentUpdate,
  type AppointmentMutationResult,
} from './appointment-write-helpers'

export type AgendaSettingsMutationResult = { ok: true } | { ok: false; error: string }

export async function updateAgendaSlotMinutes(
  slotMinutesInput: number,
): Promise<AgendaSettingsMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  if (!isValidSlotMinutes(slotMinutesInput)) {
    return { ok: false, error: 'Granularidade inválida' }
  }

  const tenantId = r.ctx.membership.tenantId
  // Event-first: estado da empresa vem do evento (sem `.update` paralelo).
  const updated = await emitEvent(TenantConfig, `tenants/${tenantId}`, {
    _tag: 'tenant.updated',
    actorId: r.ctx.session.uid,
    payload: { changes: { slotMinutes: slotMinutesInput } },
  })
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/agenda')
  return { ok: true }
}

export async function cancelAppointment(appointmentId: string): Promise<AppointmentMutationResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const ref = db
    .collection('tenants')
    .doc(r.ctx.membership.tenantId)
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(appointmentId)
  const snap = await ref.get()
  const existing = snap.data()
  if (!existing) return { ok: false, error: 'Agendamento não encontrado' }

  // Decision is pure (core); the adapter only reads + emits. Staff actor here —
  // internal panel always runs as the logged-in member. Self-cancel from the
  // customer flow (#845) sets 'customer' via its own action. Tracking is
  // populated regardless of the tenant's cancellationPolicy toggle (Wiki:
  // 04-Roadmap-Politica-Cancelamento § Tracking sempre on).
  const decision = decideCancel(existing, 'staff', new Date().toISOString())
  if (!decision.ok) return { ok: false, error: decision.error }

  // Event-first: a projeção (status/cancelledAt/By/NoticeMinutes) vem do evento.
  const cancelled = await emitEvent(
    AppointmentConfig,
    `tenants/${r.ctx.membership.tenantId}/appointments/${appointmentId}`,
    {
      _tag: 'appointment.cancelled',
      actorId: r.ctx.session.uid,
      payload: {
        cancelledBy: decision.value.cancelledBy,
        cancelledAt: decision.value.cancelledAt,
        noticeMinutes: decision.value.noticeMinutes,
      },
    },
  )
  if (!cancelled.ok) return { ok: false, error: cancelled.error }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

export async function markAppointmentNoShow(
  appointmentId: string,
): Promise<AppointmentMutationResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const ref = db
    .collection('tenants')
    .doc(r.ctx.membership.tenantId)
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(appointmentId)
  const snap = await ref.get()
  const existing = snap.data()
  if (!existing) return { ok: false, error: 'Agendamento não encontrado' }

  // Gate (pure, core): only after scheduledStartAt and only from a live booking.
  // Wiki: 04-Roadmap-Politica-Cancelamento § Quando o botão libera.
  const now = new Date()
  const decision = decideNoShow(existing, now)
  if (!decision.ok) return { ok: false, error: decision.error }

  const nowIso = now.toISOString()
  // Event-first: a projeção (status/noShowMarkedAt/By) vem do evento.
  const marked = await emitEvent(
    AppointmentConfig,
    `tenants/${r.ctx.membership.tenantId}/appointments/${appointmentId}`,
    {
      _tag: 'appointment.no_show',
      actorId: r.ctx.session.uid,
      payload: {
        markedAt: nowIso,
        markedBy: r.ctx.session.uid,
      },
    },
  )
  if (!marked.ok) return { ok: false, error: marked.error }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

export async function unmarkAppointmentNoShow(
  appointmentId: string,
): Promise<AppointmentMutationResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const ref = db
    .collection('tenants')
    .doc(r.ctx.membership.tenantId)
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(appointmentId)
  const snap = await ref.get()
  const existing = snap.data()
  if (!existing) return { ok: false, error: 'Agendamento não encontrado' }

  const decision = decideUnmarkNoShow(existing)
  if (!decision.ok) return { ok: false, error: decision.error }

  // Event-first: reverter o no-show é o evento `appointment.no_show_reverted`
  // (volta status pra scheduled; o marker anterior fica como histórico).
  const reverted = await emitEvent(
    AppointmentConfig,
    `tenants/${r.ctx.membership.tenantId}/appointments/${appointmentId}`,
    { _tag: 'appointment.no_show_reverted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!reverted.ok) return { ok: false, error: reverted.error }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}

// Fields the slot helpers read off a parsed appointment form.

export async function updateAppointment(
  appointmentId: string,
  formData: FormData,
): Promise<AppointmentMutationResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const tenant = await getTenant(r.ctx.membership.tenantId)
  if (!tenant) return { ok: false, error: 'Tenant não encontrado' }
  const parsed = parseAppointmentForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Pure (core): an edit can't create a customer and must target an existing one.
  const editable = validateEditableCustomer(parsed)
  if (!editable.ok) return { ok: false, error: editable.error }
  const customerId = editable.value.customerId

  // Write-guard (brief 0032, AC-11): editing an appointment for a blocked
  // customer in this tenant is rejected — the relationship is severed.
  const editGuard = await guardCustomerNotBlocked(r.ctx.membership.tenantId, customerId)
  if (editGuard) return editGuard

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)
  const apptRef = tenantRef
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(appointmentId)
  const snap = await apptRef.get()
  const previous = snap.data()
  if (!previous) return { ok: false, error: 'Agendamento não encontrado' }

  // Consumers read the unified catalog (brief 0023, #1004): the booked
  // `serviceId` now points at a `catalog_items` doc of kind service. The two
  // loads are independent — run them in parallel.
  const [item, professional] = await Promise.all([
    loadActiveService(tenantRef, parsed.serviceId),
    loadApprovedProfessional(tenantRef, parsed.professionalId),
  ])
  if (typeof item === 'string') return { ok: false, error: item }
  if (typeof professional === 'string') return { ok: false, error: professional }

  // snapshot-on-use decision is pure (core): service/unit change re-snapshots;
  // a pure date/time move keeps the commit-time snapshot.
  const resolved = resolveCatalogItemForUnit(item, parsed.unitId)
  const { serviceOrUnitChanged, effectiveDurationMinutes } = decideSnapshotRefresh({
    parsed,
    previous,
    resolvedDurationMinutes: resolved.durationMinutes,
  })

  const times = resolveStartEnd(tenant, parsed, effectiveDurationMinutes)
  if (typeof times === 'string') return { ok: false, error: times }
  const { startAt, endAt } = times

  const conflict = await checkSlotConflicts({
    tenantRef,
    tenant,
    parsed,
    startAt,
    endAt,
    excludeAppointmentId: appointmentId,
  })
  if (conflict) return { ok: false, error: conflict.error, conflicts: conflict.conflicts }

  // Brief 0019 — recepção respeita as mesmas regras de plano que o self-book.
  // Decisão 2026-05-22 (issue #960/#963): nenhum fluxo bypassa scope; reenforça
  // no update porque staff pode mover um appointment para fora do scope ativo.
  const scopeCheck = await enforceSubscriptionScope({
    db,
    tenantId: r.ctx.membership.tenantId,
    tenantTimezone: tenant.timezone,
    customerId,
    unitId: parsed.unitId,
    startAt,
    serviceCategoryId: item.categoryId,
    excludeAppointmentId: appointmentId,
  })
  if (!scopeCheck.ok) return { ok: false, error: scopeCheck.error }

  return persistAppointmentUpdate({
    tenantId: r.ctx.membership.tenantId,
    actorUid: r.ctx.session.uid,
    appointmentId,
    parsed: { ...parsed, customerId },
    previous,
    startAt,
    endAt,
    resolved,
    serviceOrUnitChanged,
  })
}

export async function createAppointment(formData: FormData): Promise<AppointmentMutationResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const tenant = await getTenant(r.ctx.membership.tenantId)
  if (!tenant) return { ok: false, error: 'Tenant não encontrado' }
  const parsed = parseAppointmentForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)

  // Unified catalog read (brief 0023, #1004): `serviceId` references a
  // `catalog_items` doc of kind service. The two loads are independent — run
  // them in parallel.
  const [item, professional] = await Promise.all([
    loadActiveService(tenantRef, parsed.serviceId),
    loadApprovedProfessional(tenantRef, parsed.professionalId),
  ])
  if (typeof item === 'string') return { ok: false, error: item }
  if (typeof professional === 'string') return { ok: false, error: professional }

  // Per-unit effective price/duration/commission. Same resolver is used in
  // the snapshot write below — keeping them on a single source.
  const resolved = resolveCatalogItemForUnit(item, parsed.unitId)

  const times = resolveStartEnd(tenant, parsed, resolved.durationMinutes)
  if (typeof times === 'string') return { ok: false, error: times }
  const { startAt, endAt } = times

  const conflict = await checkSlotConflicts({ tenantRef, tenant, parsed, startAt, endAt })
  if (conflict) return { ok: false, error: conflict.error, conflicts: conflict.conflicts }

  let customerId = parsed.customerId
  if (parsed.newCustomer) {
    const upsert = await upsertCustomerWithUser({
      tenantId: r.ctx.membership.tenantId,
      name: parsed.newCustomer.name,
      whatsappRaw: parsed.newCustomer.whatsapp,
      email: null,
      birthDate: null,
    })
    if (!upsert.ok) return upsert
    // Customer event emitted by the upsert layer; no extra emit needed here.
    customerId = upsert.customerId
  }

  if (!customerId) return { ok: false, error: 'Cliente não resolvido' }

  // Write-guard (brief 0032, AC-11): a blocked customer's relationship is
  // severed — no new appointment may be created for them in this tenant. A
  // freshly upserted customer can't be blocked, but an existing `customerId`
  // can, so guard after resolution.
  const createGuard = await guardCustomerNotBlocked(r.ctx.membership.tenantId, customerId)
  if (createGuard) return createGuard

  // Brief 0019 — recepção respeita as mesmas regras de plano que o self-book.
  // Decisão 2026-05-22 (issue #960/#963): nenhum fluxo bypassa scope; casos
  // excepcionais resolvem-se via ajuste de Subscription do cliente.
  const scopeCheck = await enforceSubscriptionScope({
    db,
    tenantId: r.ctx.membership.tenantId,
    tenantTimezone: tenant.timezone,
    customerId,
    unitId: parsed.unitId,
    startAt,
    serviceCategoryId: item.categoryId,
  })
  if (!scopeCheck.ok) return { ok: false, error: scopeCheck.error }

  const userIds = await resolveAppointmentUserIds(
    r.ctx.membership.tenantId,
    customerId,
    parsed.professionalId,
  )
  if (!userIds.ok) return userIds

  const apptRef = tenantRef.collection('appointments').doc()
  const now = new Date().toISOString()
  const appointment: Appointment = {
    id: apptRef.id,
    tenantId: r.ctx.membership.tenantId,
    unitId: parsed.unitId,
    professionalId: parsed.professionalId,
    customerId,
    serviceId: parsed.serviceId,
    startAt,
    endAt,
    status: 'scheduled',
    servicePriceCentsSnapshot: resolved.priceCents,
    serviceDurationMinutesSnapshot: resolved.durationMinutes,
    commissionSnapshot: resolved.commission,
    // Snapshot da cancellation policy no commit (#1038). Editar a policy do
    // tenant depois não retroage sobre o direito de cancelar deste booking.
    cancellationPolicySnapshot: normalizeCancellationPolicy(tenant.cancellationPolicy),
    customerUserId: userIds.ids.customerUserId,
    professionalUserId: userIds.ids.professionalUserId,
    createdAt: now,
    updatedAt: now,
  }

  // Authoritative anti-double-book (#843). Pre-flight above gave us a fast
  // staff-friendly error message; this transaction is what actually protects
  // the slot from concurrent public landings + staff agenda writes.
  const commit = await commitAppointmentBooking({
    db,
    tenantRef,
    appointment,
    actorUid: r.ctx.session.uid,
    via: 'internal_panel',
  })
  if (!commit.ok) {
    return {
      ok: false,
      error: 'Esse horário acabou de ser ocupado. Recarregue a agenda e tente outro.',
      conflicts: ['agendamento existente'],
    }
  }
  // `appointment.created` é emitido event-first DENTRO do commit transacional
  // (commitAppointmentBooking) — sem emit paralelo aqui (era dual-write).

  revalidatePath('/agenda')
  return { ok: true, appointmentId: apptRef.id }
}

// ── Form action wrappers (useActionState-compatible) ─────────────────────────
//
// The dialog ships these actions via `<form action={…}>` so the buttons are
// progressively enhanced — they post natively even before React hydrates,
// killing the hydration race that was causing the agenda dialog flakes.
//
// Each wrapper:
//   1. Reads the appointmentId from a hidden input (form submit boundary).
//   2. Delegates to the existing imperative action (kept untouched so unit
//      tests + non-form callers keep their signature).
//   3. Returns `{ ok, error }` so `useActionState` can drive client UI
//      (error display + dialog close on success). On server-side submit
//      (no JS), `revalidatePath('/agenda')` inside the inner action re-renders
//      the page and the new state shows up — the dialog naturally rebuilds
//      from the fresh data.
//
// `prevState` is the React 19 `useActionState` convention — required by the
// signature even when unused.

// Shape returned by the form-action wrappers below — also imported by the
// dialog as the `useActionState` initial value. Defined inline in each
// caller (a `'use server'` file may only export async functions; types are
// stripped at build time and don't violate the rule, but a const initial
// state would, so callers initialise `{ ok: false }` themselves).
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
