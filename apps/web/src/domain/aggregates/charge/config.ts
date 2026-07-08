import type { AggregateConfig, EventEnvelope } from '@/domain/effect/event-store'
import { ChargeEventSchema, type ChargeEvent } from './events'
import { applyChargeEvent } from './reducer'
import { INITIAL_CHARGE_STATE, type ChargeState } from './types'

// v1→v2 (ADR 0016 D5): `Charge` ganhou `refundedAt` (non-null SSE refunded), e o
// evento `charge.refunded` passou a existir. `charge.created` carries the full
// `Charge` (`data`), so a legacy v1 `charge.created` payload lacks the now-required
// `refundedAt` key and would fail the v2 decode — inject `refundedAt: null`
// (a legacy charge was never refunded; the event didn't exist). The other charge
// events carry `Schema.partial(Charge)` (`changes`), where every field is optional,
// so they decode v1 untouched. Same production-truth rationale as OrderConfig
// (oilio is live; audit #1383). Production has ZERO charge events today
// (charge_evts=0), so this only guards local dumps and future replay.
function upcastChargeV1ToV2(raw: EventEnvelope): EventEnvelope {
  if (raw._tag === 'charge.created') {
    const data = raw.payload['data']
    if (data !== null && typeof data === 'object' && !('refundedAt' in data)) {
      return {
        ...raw,
        payload: { ...raw.payload, data: { ...data, refundedAt: null } },
      }
    }
  }
  return raw
}

export const ChargeConfig: AggregateConfig<ChargeState, ChargeEvent> = {
  type: 'charge',
  initialState: INITIAL_CHARGE_STATE,
  reducer: applyChargeEvent,
  schema: ChargeEventSchema,
  currentSchemaVersion: 2,
  upcasters: { 1: upcastChargeV1ToV2 },
}
