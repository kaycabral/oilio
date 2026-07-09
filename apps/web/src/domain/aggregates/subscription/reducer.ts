import type { EventMeta } from '@/domain/effect/event-store'
import type { SubscriptionEvent } from './events'
import type { SubscriptionState } from './types'

export function applySubscriptionEvent(
  state: SubscriptionState,
  event: SubscriptionEvent,
  meta: EventMeta,
): SubscriptionState {
  const base: SubscriptionState = {
    ...state,
    _version: meta.version,
    updatedAt: meta.timestamp,
  }

  switch (event._tag) {
    case 'subscription.created': {
      return {
        ...base,
        id: event.id,
        orgId: event.orgId,
        unitId: event.unitId,
        customerId: event.customerId,
        customerUserId: event.customerUserId,
        plan: event.plan,
        status: 'pending',
        currentPeriod: { startAt: event.periodStart, endAt: event.periodEnd, consumed: 0 },
        cancelAtPeriodEnd: false,
        nextChargeDate: event.nextChargeDate,
        pastDueCycles: 0,
        pastDueThreshold: event.pastDueThreshold,
        cancellationReason: null,
        cancelledAt: null,
        createdAt: meta.timestamp,
      }
    }
    case 'subscription.charge_settled':
      return state.status === 'cancelled' ? base : { ...base, status: 'active' }
    case 'subscription.charge_failed': {
      return { ...base, status: event.status ?? 'past_due' }
    }
    case 'subscription.cancelled_for_non_payment':
      return { ...base, status: 'cancelled_for_non_payment' }
    case 'subscription.cancelled':
      return {
        ...base,
        status: 'cancelled',
        cancelAtPeriodEnd: false,
        cancelledAt: meta.timestamp,
        nextChargeDate: null,
      }
    case 'subscription.cancel_scheduled': {
      return { ...base, cancelAtPeriodEnd: true, cancellationReason: event.cancellationReason }
    }
    case 'subscription.reactivated':
      return { ...base, cancelAtPeriodEnd: false, cancellationReason: null, cancelledAt: null }
    case 'subscription.renewed': {
      return {
        ...base,
        currentPeriod: { startAt: event.periodStart, endAt: event.periodEnd, consumed: 0 },
        nextChargeDate: event.nextChargeDate,
      }
    }
    case 'subscription.plan_changed': {
      return { ...base, plan: event.plan }
    }
    case 'subscription.usage_incremented': {
      return {
        ...base,
        currentPeriod: {
          ...state.currentPeriod,
          consumed: state.currentPeriod.consumed + event.amount,
        },
      }
    }
    case 'subscription.deleted':
      return base
  }
}
