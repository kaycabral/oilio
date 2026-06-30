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
import { enforceSlotGrid } from '@/features/booking/adapters/enforce-slot-grid'
import { enforceSubscriptionScope } from '@/features/booking/adapters/enforce-subscription-scope'
import { revalidatePath } from 'next/cache'

import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'

import { getAppointmentById } from '@/shared/org/appointment-read'
import { resolveWriteSecurity } from '@/shared/org/member-operation-read'
import { canActOnOwnedResource, requireOrgCtx } from '@/shared/org/membership'
import { getUnitById } from '@/shared/org/unit-read'
import {
  checkSlotConflicts,
  guardCustomerNotBlocked,
  loadActiveCatalogService,
  loadApprovedMemberOperation,
  persistAppointmentUpdate,
  resolveAppointmentCustomerId,
  type AppointmentMutationResult,
} from './appointment-write-helpers'

// Own-resource wall (brief 0075, #1257): the balcão (owner/manager/recepção)
// acts on any appointment; a self-scoped memberOperation only on their own
// (`appointment.memberOperatorUserId === membership.userId`). Defense-in-depth over
// the RLS own-scope — a null owner never matches a memberOperation, so they're
// blocked and the balcão passes. Returns the error result the actions return.
function ensureCanActOnAppointment(
  membership: Membership,
  appointment: Appointment,
): AppointmentMutationResult | null {
  if (canActOnOwnedResource(membership, appointment.memberOperatorUserId ?? '')) return null
  return { ok: false, error: 'Você só pode alterar os próprios agendamentos' }
}

// Resolves the loaded-memberOperation result for createAppointment: surfaces the
// load error, then the own-scope wall (brief 0075, #1257) — a self-scoped
// memberOperation books only for themselves; the balcão books for anyone. Keeps the
// branching out of `createAppointment` (cognitive complexity).
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

  // Decision is pure (core); the adapter only reads + emits. Staff actor here —
  // internal panel always runs as the logged-in member. Self-cancel from the
  // customer flow (#845) sets 'customer' via its own action. Tracking is
  // populated regardless of the org's cancellationPolicy toggle (Wiki:
  // 04-Roadmap-Politica-Cancelamento § Tracking sempre on).
  const decision = decideCancel(existing, 'staff', new Date().toISOString())
  if (!decision.ok) return { ok: false, error: decision.error }

  // Event-first: a projeção (status/cancelledAt/By/NoticeMinutes) vem do evento.
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

  // Gate (pure, core): only after scheduledStartAt and only from a live booking.
  // Wiki: 04-Roadmap-Politica-Cancelamento § Quando o botão libera.
  const now = new Date()
  const decision = decideNoShow(existing, now)
  if (!decision.ok) return { ok: false, error: decision.error }

  const nowIso = now.toISOString()
  // Event-first: a projeção (status/noShowMarkedAt/By) vem do evento.
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

  // Event-first: reverter o no-show é o evento `appointment.no_show_reverted`
  // (volta status pra scheduled; o marker anterior fica como histórico).
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

// Fields the slot helpers read off a parsed appointment form.

export async function updateAppointment(
  appointmentId: string,
  formData: FormData,
): Promise<AppointmentMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const parsed = parseAppointmentForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Timezone + cancellation policy are establishment/agenda concerns of the
  // target unit (PRD Identidade v2 — moved Org→Unit). Resolve the unit the
  // appointment belongs to and source them from its agenda.
  const unit = await getUnitById(r.ctx.membership.orgId, parsed.unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }

  // Pure (core): an edit can't create a customer and must target an existing one.
  const editable = validateEditableCustomer(parsed)
  if (!editable.ok) return { ok: false, error: editable.error }
  const customerId = editable.value.customerId

  // Write-guard (brief 0032, AC-11): editing an appointment for a blocked
  // customer in this org is rejected — the relationship is severed.
  const editGuard = await guardCustomerNotBlocked(r.ctx.membership.orgId, customerId)
  if (editGuard) return editGuard

  const previous = await getAppointmentById(r.ctx.membership.orgId, appointmentId)
  if (!previous) return { ok: false, error: 'Agendamento não encontrado' }
  {
    const denied = ensureCanActOnAppointment(r.ctx.membership, previous)
    if (denied) return denied
  }

  // Consumers read the unified catalog (brief 0023, #1004): the booked
  // `serviceId` now points at a `catalog_items` doc of kind service. The two
  // loads are independent — run them in parallel.
  const [item, memberOperation] = await Promise.all([
    loadActiveCatalogService(r.ctx.membership.orgId, parsed.serviceId),
    loadApprovedMemberOperation(r.ctx.membership.orgId, parsed.memberOperationId),
  ])
  if (typeof item === 'string') return { ok: false, error: item }
  if (typeof memberOperation === 'string') return { ok: false, error: memberOperation }

  // snapshot-on-use decision is pure (core): service/unit change re-snapshots;
  // a pure date/time move keeps the commit-time snapshot.
  const resolved = resolveCatalogItemForUnit(item, parsed.unitId)
  const { serviceOrUnitChanged, effectiveDurationMinutes } = decideSnapshotRefresh({
    parsed,
    previous,
    resolvedDurationMinutes: resolved.durationMinutes,
  })

  const times = resolveStartEnd({ timezone: unit.timezone }, parsed, effectiveDurationMinutes)
  if (typeof times === 'string') return { ok: false, error: times }
  const { startAt, endAt } = times

  // Brief 0080 — reception follows the same configured grid as the public
  // self-book: a move to a `startAt` off the slot grid / outside hours is
  // rejected on the server, no privileged surface.
  const gridCheck = enforceSlotGrid({
    unit,
    startAt,
    surface: 'reception',
    orgId: r.ctx.membership.orgId,
    userId: r.ctx.session.uid,
  })
  if (!gridCheck.ok) return { ok: false, error: gridCheck.error }

  const conflict = await checkSlotConflicts({
    orgId: r.ctx.membership.orgId,
    org: { timezone: unit.timezone },
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
    orgId: r.ctx.membership.orgId,
    orgTimezone: unit.timezone,
    customerId,
    unitId: parsed.unitId,
    startAt,
    serviceCategoryId: item.categoryId,
    excludeAppointmentId: appointmentId,
  })
  if (!scopeCheck.ok) return { ok: false, error: scopeCheck.error }

  // Own-scope RLS for the edit write (brief 0075, #1265): same capability-gated
  // scope as the create path, forwarded to every event append.
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

  // Timezone + cancellation policy are establishment/agenda concerns of the
  // target unit (PRD Identidade v2 — moved Org→Unit).
  const unit = await getUnitById(r.ctx.membership.orgId, parsed.unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }

  // Unified catalog read (brief 0023, #1004): `serviceId` references a
  // `catalog_items` doc of kind service. The two loads are independent — run
  // them in parallel.
  const [item, memberOperation] = await Promise.all([
    loadActiveCatalogService(r.ctx.membership.orgId, parsed.serviceId),
    loadApprovedMemberOperation(r.ctx.membership.orgId, parsed.memberOperationId),
  ])
  if (typeof item === 'string') return { ok: false, error: item }
  const bookableError = resolveBookableError(r.ctx.membership, memberOperation)
  if (bookableError) return bookableError

  // Per-unit effective price/duration/commission. Same resolver is used in
  // the snapshot write below — keeping them on a single source.
  const resolved = resolveCatalogItemForUnit(item, parsed.unitId)

  const times = resolveStartEnd({ timezone: unit.timezone }, parsed, resolved.durationMinutes)
  if (typeof times === 'string') return { ok: false, error: times }
  const { startAt, endAt } = times

  // Brief 0080 — reception follows the same configured grid as the public
  // self-book: a `startAt` off the slot grid / outside hours is rejected on the
  // server, no privileged surface, no arbitrary walk-in encaixe.
  const gridCheck = enforceSlotGrid({
    unit,
    startAt,
    surface: 'reception',
    orgId: r.ctx.membership.orgId,
    userId: r.ctx.session.uid,
  })
  if (!gridCheck.ok) return { ok: false, error: gridCheck.error }

  const conflict = await checkSlotConflicts({
    orgId: r.ctx.membership.orgId,
    org: { timezone: unit.timezone },
    parsed,
    startAt,
    endAt,
  })
  if (conflict) return { ok: false, error: conflict.error, conflicts: conflict.conflicts }

  // Resolve the target customer — existing pick, or a brand-new one upserted
  // inline (the inline branch is gated server-side on `canManageCustomers`,
  // brief 0075 #1266). Extracted to keep this action under the complexity gate.
  const resolvedCustomer = await resolveAppointmentCustomerId(r.ctx.membership, parsed)
  if (!resolvedCustomer.ok) return resolvedCustomer
  const customerId = resolvedCustomer.customerId

  // Write-guard (brief 0032, AC-11): a blocked customer's relationship is
  // severed — no new appointment may be created for them in this org. A
  // freshly upserted customer can't be blocked, but an existing `customerId`
  // can, so guard after resolution.
  const createGuard = await guardCustomerNotBlocked(r.ctx.membership.orgId, customerId)
  if (createGuard) return createGuard

  // Brief 0019 — recepção respeita as mesmas regras de plano que o self-book.
  // Decisão 2026-05-22 (issue #960/#963): nenhum fluxo bypassa scope; casos
  // excepcionais resolvem-se via ajuste de Subscription do cliente.
  const scopeCheck = await enforceSubscriptionScope({
    orgId: r.ctx.membership.orgId,
    orgTimezone: unit.timezone,
    customerId,
    unitId: parsed.unitId,
    startAt,
    serviceCategoryId: item.categoryId,
  })
  if (!scopeCheck.ok) return { ok: false, error: scopeCheck.error }

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
    // Snapshot da cancellation policy no commit (#1038). Editar a policy da
    // unidade depois não retroage sobre o direito de cancelar deste booking. A
    // policy é da agenda da unidade (modo appointment); fora desse modo não
    // existe — cai no default (PRD Identidade v2 — config movida Org→Unit).
    cancellationPolicySnapshot: unitCancellationPolicySnapshot(unit.agenda),
    customerUserId: userIds.ids.customerUserId,
    memberOperatorUserId: userIds.ids.memberOperatorUserId,
    // Internal balcão booking (brief 0077 AC-11): no acquisition channel — the
    // staff created it directly, not via a contextual link.
    attribution: null,
    createdAt: now,
    updatedAt: now,
  }

  // Own-scope RLS for the WRITE (brief 0075, #1265): the DB own-scope WITH CHECK
  // is the last line of defense — a self-scoped member can't book onto a colleague
  // even past the application gate above. The balcão passes no security.
  const security = await resolveWriteSecurity(r.ctx.membership, parsed.unitId)

  // Authoritative anti-double-book (#843). Pre-flight above gave us a fast
  // staff-friendly error message; this transaction is what actually protects
  // the slot from concurrent public landings + staff agenda writes.
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
      error: 'Esse horário acabou de ser ocupado. Recarregue a agenda e tente outro.',
      conflicts: ['agendamento existente'],
    }
  }
  // `appointment.created` é emitido event-first DENTRO do commit transacional
  // (commitAppointmentBooking) — sem emit paralelo aqui (era dual-write).

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
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
