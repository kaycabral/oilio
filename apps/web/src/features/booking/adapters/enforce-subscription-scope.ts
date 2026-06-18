import { getTodayInOrgTz, isBookingLimitsUnrestricted, StoredCustomer } from '@/domain'
import { checkBookingLimits } from '@/features/booking/adapters/check-booking-limits'
import { resolveCustomerSubscriptionScope } from '@/features/booking/adapters/subscription-scope.repo'
import {
  checkCategoryCoverage,
  checkTimeScope,
  checkUnitAllowlist,
  type ScopeBlocked,
} from '@/features/booking/core/subscription-scope-rules'
import { fsConverter } from '@/shared/db/converter'
import type { Firestore } from 'firebase-admin/firestore'
import 'server-only'

export type ScopeEnforcementOk = { ok: true }
export type ScopeEnforcementBlocked = ScopeBlocked
export type ScopeEnforcementResult = ScopeEnforcementOk | ScopeEnforcementBlocked

type SubscriptionScope = Awaited<ReturnType<typeof resolveCustomerSubscriptionScope>>

async function checkLimits(args: {
  db: Firestore
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
    db: args.db,
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
  db: Firestore
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
  const { db, orgId, orgTimezone, customerId, unitId, startAt, serviceCategoryId } = args

  const orgRef = db.collection('orgs').doc(orgId)
  const customerSnap = await orgRef
    .collection('customers')
    .withConverter(fsConverter(StoredCustomer))
    .doc(customerId)
    .get()
  const customer = customerSnap.data()
  if (!customer) return { ok: true }
  if (!customer.userId) return { ok: true }

  const scope = await resolveCustomerSubscriptionScope(orgId, customer.userId)
  const todayIso = getTodayInOrgTz(orgTimezone)

  return (
    checkUnitAllowlist(scope, unitId) ??
    checkCategoryCoverage(scope, serviceCategoryId) ??
    checkTimeScope(scope, startAt, orgTimezone, todayIso) ??
    (await checkLimits({
      db,
      orgId,
      orgTimezone,
      customerId,
      startAt,
      excludeAppointmentId: args.excludeAppointmentId,
      scope,
    })) ?? { ok: true }
  )
}
