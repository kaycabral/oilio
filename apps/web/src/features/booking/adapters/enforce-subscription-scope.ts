import { getTodayInOrgTz, isBookingLimitsUnrestricted } from '@/domain'
import { checkBookingLimits } from '@/features/booking/adapters/check-booking-limits'
import { resolveCustomerSubscriptionScope } from '@/features/booking/adapters/subscription-scope.repo'
import {
  checkCategoryCoverage,
  checkTimeScope,
  checkUnitAllowlist,
  type ScopeBlocked,
} from '@/features/booking/core/subscription-scope-rules'
import { getCustomerUserId } from '@/shared/org/customer-read'
import 'server-only'

export type ScopeEnforcementOk = { ok: true }
export type ScopeEnforcementBlocked = ScopeBlocked
export type ScopeEnforcementResult = ScopeEnforcementOk | ScopeEnforcementBlocked

type SubscriptionScope = Awaited<ReturnType<typeof resolveCustomerSubscriptionScope>>

async function checkLimits(args: {
  orgId: string
  orgTimezone: string
  customerId: string
  startAt: string
  excludeAppointmentId?: string
  scope: SubscriptionScope
}): Promise<ScopeEnforcementBlocked | null> {
  const { scope } = args
  if (!scope.bookingLimits || isBookingLimitsUnrestricted(scope.bookingLimits)) return null
  const limitCheck = await checkBookingLimits({
    orgId: args.orgId,
    orgTimezone: args.orgTimezone,
    customerId: args.customerId,
    limits: scope.bookingLimits,
    proposedStartAt: args.startAt,
    excludeAppointmentId: args.excludeAppointmentId,
  })
  if (limitCheck.kind === 'reschedule-required') {
    return {
      ok: false,
      rule: 'maxPerDay',
      error: `Cliente já atingiu o limite de ${limitCheck.maxPerDay} agendamento(s) no dia pelo plano dele. Reagende o existente em vez de criar novo.`,
    }
  }
  if (limitCheck.kind === 'blocked') {
    const rule = limitCheck.rule
    const msg =
      rule === 'maxConcurrent'
        ? 'Cliente já atingiu o limite de agendamentos futuros simultâneos pelo plano dele.'
        : 'Plano do cliente exige concluir o agendamento atual antes de marcar novo.'
    return { ok: false, rule, error: msg }
  }
  return null
}

export async function enforceSubscriptionScope(args: {
  orgId: string
  orgTimezone: string
  customerId: string
  unitId: string
  startAt: string
  serviceCategoryId?: string | null
  excludeAppointmentId?: string
}): Promise<ScopeEnforcementResult> {
  const { orgId, orgTimezone, customerId, unitId, startAt, serviceCategoryId } = args

  const userId = await getCustomerUserId(orgId, customerId)
  if (!userId) return { ok: true }

  const scope = await resolveCustomerSubscriptionScope(orgId, userId)
  const todayIso = getTodayInOrgTz(orgTimezone)

  return (
    checkUnitAllowlist(scope, unitId) ??
    checkCategoryCoverage(scope, serviceCategoryId) ??
    checkTimeScope(scope, startAt, orgTimezone, todayIso) ??
    (await checkLimits({
      orgId,
      orgTimezone,
      customerId,
      startAt,
      excludeAppointmentId: args.excludeAppointmentId,
      scope,
    })) ?? { ok: true }
  )
}
