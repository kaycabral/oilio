import type { EventMeta } from '@/domain/effect/event-store'
import type { SubscriptionPlanEvent } from './events'
import type { SubscriptionPlanState } from './types'

export function applySubscriptionPlanEvent(
  state: SubscriptionPlanState,
  event: SubscriptionPlanEvent,
  meta: EventMeta,
): SubscriptionPlanState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'subscription_plan.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'subscription_plan.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'subscription_plan.archived':
      return { ...base, archivedAt: event.archivedAt }
    case 'subscription_plan.deleted':
      return base
  }
}
