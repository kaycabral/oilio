import type { EventMeta } from '@/domain/effect/event-store'
import type { OrderEvent } from './events'
import type { OrderState } from './types'

export function applyOrderEvent(state: OrderState, event: OrderEvent, meta: EventMeta): OrderState {
  const _version = meta.version

  switch (event._tag) {
    case 'order.created':
      return { ...event.data, _version }
    case 'order.item_added':
    case 'order.item_removed':
    case 'order.item_attribution_changed':
    case 'order.item_coverage_changed':
    case 'order.meta_updated':
      if (state.status !== 'open') {
        throw new Error(`${event._tag} aplicado a order ${state.status} (${state.id})`)
      }
      return { ...state, ...event.changes, _version }
    case 'order.customer_assigned':
      if (state.status !== 'open') {
        throw new Error(`${event._tag} aplicado a order ${state.status} (${state.id})`)
      }
      return { ...state, customerId: event.customerId, updatedAt: meta.timestamp, _version }
    case 'order.cancelled':
      return {
        ...state,
        status: 'cancelled',
        closedAt: null,
        paymentMethod: null,
        updatedAt: meta.timestamp,
        _version,
      }
    case 'order.closed':
      return {
        ...state,
        status: 'closed',
        closedAt: event.closedAt,
        subtotalCents: event.subtotalCents,
        totalCents: event.totalCents,
        paymentMethod: event.paymentMethod,
        updatedAt: meta.timestamp,
        _version,
      }
    case 'order.reopened':
      return {
        ...state,
        status: 'open',
        paymentMethod: null,
        closedAt: null,
        updatedAt: meta.timestamp,
        _version,
      }
  }
}
