import type { AggregateConfig, EventEnvelope } from '@/domain/effect/event-store'
import { OrderEventSchema, type OrderEvent } from './events'
import { applyOrderEvent } from './reducer'
import { INITIAL_ORDER_STATE, type OrderState } from './types'

// v1→v2 (ADR 0016 D5): `order.closed` ganhou o snapshot `items` + `unitId`;
// `order.reopened` ganhou `reopenedAt` + `reversedClosedAt` + `reversedRevenueCents` + `unitId`. THE FIRST REGISTERED UPCASTER of the
// codebase (the mechanism already existed — event-store.ts:85,508 — no aggregate
// used it yet). oilio IS in production (verified against GCP, not docs — the
// pre-prod comment on member-operation was false, audit #1383), so a persisted
// payload change MUST bump + upcast: without it, replay of a legacy v1 event
// decodes against the v2 schema and either drops the renamed shape or fails.
//
// Runs per ISOLATED envelope (no stream context), so it CANNOT reconstruct the
// closed order's items from the earlier `item_added` events — it fills the added
// fields with schema-valid neutrals. That is sound here because production has
// ZERO `order.closed`/`order.reopened` v1 events (verified: order_closed=0,
// order_reopened=0) — the only order events are created/cancelled, which this
// upcaster passes through untouched. The neutrals are the correct contract for a
// hypothetical legacy dump: a pre-D5 closed order simply contributes no per-item
// revenue to the Razão (it predates the model), never a decode failure.
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
        // Legacy reopen carries no revenue/unit snapshot: neutral 0/'' — a pre-D5
        // reversal simply contributes no counter-entry (it predates the model),
        // never a decode failure. Production has ZERO reopened events (verified).
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
