import type { AggregateConfig, EventEnvelope } from '@/domain/effect/event-store'
import { OrderEventSchema, type OrderEvent } from './events'
import { applyOrderEvent } from './reducer'
import { INITIAL_ORDER_STATE, type OrderState } from './types'

function upcastOrderV1ToV2(raw: EventEnvelope): EventEnvelope {
  if (raw._tag === 'order.closed') {
    const needsItems = raw.payload['items'] === undefined
    const needsUnit = raw.payload['unitId'] === undefined
    if (needsItems || needsUnit) {
      return {
        ...raw,
        payload: {
          ...raw.payload,
          ...(needsItems ? { items: [] } : {}),
          ...(needsUnit ? { unitId: '' } : {}),
        },
      }
    }
  }
  if (raw._tag === 'order.reopened') {
    const reversedClosedAt = raw.payload['reversedClosedAt']
    const closedFallback = typeof reversedClosedAt === 'string' ? reversedClosedAt : raw.timestamp
    return {
      ...raw,
      payload: {
        ...raw.payload,
        reopenedAt: raw.payload['reopenedAt'] ?? raw.timestamp,
        reversedClosedAt: raw.payload['reversedClosedAt'] ?? closedFallback,
        reversedRevenueCents: raw.payload['reversedRevenueCents'] ?? 0,
        unitId: raw.payload['unitId'] ?? '',
      },
    }
  }
  return raw
}

export const OrderConfig: AggregateConfig<OrderState, OrderEvent> = {
  type: 'order',
  initialState: INITIAL_ORDER_STATE,
  reducer: applyOrderEvent,
  schema: OrderEventSchema,
  currentSchemaVersion: 2,
  upcasters: { 1: upcastOrderV1ToV2 },
}
