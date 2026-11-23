import type { AggregateConfig, EventEnvelope } from '@/domain/effect/event-store'
import { ChargeEventSchema, type ChargeEvent } from './events'
import { applyChargeEvent } from './reducer'
import { INITIAL_CHARGE_STATE, type ChargeState } from './types'

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
