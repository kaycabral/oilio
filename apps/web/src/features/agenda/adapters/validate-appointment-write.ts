import type { Unit } from '@/domain'
import type { SlotInput } from '@/features/agenda/core/appointment-form'
import { enforceSlotGrid } from '@/features/booking/adapters/enforce-slot-grid'
import { enforceSubscriptionScope } from '@/features/booking/adapters/enforce-subscription-scope'
import 'server-only'
import { checkSlotConflicts } from './appointment-write-helpers'

// The single appointment-write validation layer (brief 0080, Grupo B — AC-04):
// the checks that EVERY booking surface must run, in one place, in one order —
// slot-grid → overlap (blocks + double-book pre-flight) → subscription scope.
// Before this, `createAppointment` and `updateAppointment` repeated the exact
// same block inline (drift risk); the self-book wizard ran the same primitives
// in a surface-specific order. Consolidating here means a new gate is added
// once and can't be forgotten on a surface.
//
// No gate is removed (AC-05): each underlying check keeps its existing
// behaviour; the authoritative in-transaction double-book check still runs at
// commit time downstream — `checkSlotConflicts` is the staff-friendly
// pre-flight, exactly as before.

export type AppointmentWriteValid = { ok: true }
export type AppointmentWriteInvalid = {
  ok: false
  error: string
  // Conflict labels from the overlap pre-flight, surfaced to the agenda UI.
  conflicts?: string[]
}
export type AppointmentWriteValidation = AppointmentWriteValid | AppointmentWriteInvalid

export async function validateAppointmentWrite(args: {
  orgId: string
  unit: Pick<Unit, 'id' | 'timezone' | 'agenda'>
  // Acting user — the operator for reception, the customer for self-book.
  userId: string
  surface: 'self_book' | 'reception'
  // Parsed slot identity (unit/member/service/date) for the overlap query.
  parsed: SlotInput
  startAt: string
  endAt: string
  // The customer the booking is for, and the booked service's category — both
  // needed by the subscription-scope chain (brief 0019).
  customerId: string
  serviceCategoryId?: string | null
  // Set on an edit so the appointment being moved doesn't conflict with itself.
  excludeAppointmentId?: string
}): Promise<AppointmentWriteValidation> {
  // Duration from the resolved slot — drives the "ends within hours" check and
  // stays consistent with the overlap window below.
  const durationMinutes = Math.round(
    (new Date(args.endAt).getTime() - new Date(args.startAt).getTime()) / 60_000,
  )
  const grid = enforceSlotGrid({
    unit: args.unit,
    startAt: args.startAt,
    durationMinutes,
    surface: args.surface,
    orgId: args.orgId,
    userId: args.userId,
  })
  if (!grid.ok) return { ok: false, error: grid.error }

  const conflict = await checkSlotConflicts({
    orgId: args.orgId,
    org: { timezone: args.unit.timezone },
    parsed: args.parsed,
    startAt: args.startAt,
    endAt: args.endAt,
    excludeAppointmentId: args.excludeAppointmentId,
  })
  if (conflict) return { ok: false, error: conflict.error, conflicts: conflict.conflicts }

  const scope = await enforceSubscriptionScope({
    orgId: args.orgId,
    orgTimezone: args.unit.timezone,
    customerId: args.customerId,
    unitId: args.parsed.unitId,
    startAt: args.startAt,
    serviceCategoryId: args.serviceCategoryId,
    excludeAppointmentId: args.excludeAppointmentId,
  })
  if (!scope.ok) return { ok: false, error: scope.error }

  return { ok: true }
}
