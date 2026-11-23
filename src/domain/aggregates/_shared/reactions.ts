import { Effect } from 'effect'

import type { EventEnvelope } from '@/domain/effect/event-store'

export type EventReaction<R = never, E = never> = {
  readonly trigger: string
  readonly handle: (envelope: EventEnvelope) => Effect.Effect<void, E, R>
}

export function buildReactor<R, E>(reactions: readonly EventReaction<R, E>[]) {
  const byTrigger = new Map<string, EventReaction<R, E>[]>()
  for (const r of reactions) {
    const list = byTrigger.get(r.trigger) ?? []
    list.push(r)
    byTrigger.set(r.trigger, list)
  }

  return (envelope: EventEnvelope): Effect.Effect<void, E, R> =>
    Effect.gen(function* () {
      const handlers = byTrigger.get(envelope._tag) ?? []
      for (const h of handlers) {
        yield* h.handle(envelope)
      }
    })
}
