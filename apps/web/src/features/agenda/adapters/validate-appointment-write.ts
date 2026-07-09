import type { Unit } from '@/domain'
import type { SlotInput } from '@/features/agenda/core/appointment-form'
import { enforceSlotGrid } from '@/features/booking/adapters/enforce-slot-grid'
import { enforceSubscriptionScope } from '@/features/booking/adapters/enforce-subscription-scope'
import 'server-only'
import { checkSlotConflicts } from './appointment-write-helpers'

export type AppointmentWriteValid = { ok: true }
export type AppointmentWriteInvalid = {
  ok: false
  error: string
  conflicts?: string[]
}
export type AppointmentWriteValidation = AppointmentWriteValid | AppointmentWriteInvalid

export async function validateAppointmentWrite(args: {
  orgId: string
  unit: Pick<Unit, 'id' | 'timezone' | 'agenda'>
  userId: string
  surface: 'self_book' | 'reception'
  parsed: SlotInput
  startAt: string
  endAt: string
  customerId: string
  serviceCategoryId?: string | null
  excludeAppointmentId?: string
}): Promise<AppointmentWriteValidation> {
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
