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
  // Category of the booked service (brief 0023, AC-06 — #1004). Resolved from
  // the catalog item's `categoryId`. When the customer's plan restricts coverage
  // to a category set, a service outside it is rejected. `null` when the item is
  // uncategorized — covered only if the plan is unrestricted. Optional so
  // non-booking callers don't break.
  serviceCategoryId?: string | null
  excludeAppointmentId?: string
}): Promise<ScopeEnforcementResult> {
  const { orgId, orgTimezone, customerId, unitId, startAt, serviceCategoryId } = args

  // Backend-aware read (Postgres typed table under RLS / Firestore subcollection).
  // Only the linked `userId` is needed; use the tolerant `getCustomerUserId` (not
  // the strict-decoding `getCustomerById`) so a degenerate shadow doc doesn't
  // throw — scope enforcement degrades to "allow" on an unresolvable customer.
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
