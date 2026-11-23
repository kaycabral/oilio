// Thin wrapper over `emitEvent` for single-aggregate seed writes: builds the
// typed `AggregateRef` from the config + (orgId, id) and throws on a non-ok
// outcome (a seed must fail loudly, not silently skip a write). Cross-aggregate
// cascades use `commitSaga` directly (see the saga helpers), not this.

import type { AggregateConfig, EventInput } from '@/domain/effect'
import { aggregateRef } from '@/domain/effect'
import { emitEvent } from '@/shared/effect-bridge'

export async function emitOne<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  orgId: string,
  id: string,
  input: EventInput<Event['_tag']>,
): Promise<void> {
  const outcome = await emitEvent(config, aggregateRef(config, orgId, id), input)
  if (!outcome.ok) {
    throw new Error(`emit ${String(input._tag)} for ${orgId}/${id} failed: ${outcome.error}`)
  }
}
