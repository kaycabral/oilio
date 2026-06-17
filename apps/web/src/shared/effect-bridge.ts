import {
  appendEvent,
  appendEventGuarded,
  type AggregateConfig,
  type EventInput,
  type GuardedAppend,
} from '@/domain/effect'
import { FirestoreLayerLive } from '@/shared/db/effect'
import { Effect } from 'effect'

export async function emitEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(
  config: AggregateConfig<State, Event>,
  aggregatePath: string,
  input: EventInput<Event['_tag']>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    appendEvent(config, aggregatePath, input).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.provide(FirestoreLayerLive),
    ),
  )
}

// Atomic use-time guard (brief 0033 AC-08/AC-09). Resolves the event payload
// from a transactional read of a definition doc (catalog-item / plan) INSIDE the
// append transaction, so a concurrent discontinuation/reprice closes the TOCTOU
// race via Firestore optimistic concurrency. The `guard` reads the definition
// (locking it), rejects when discontinued, and snapshots `min(displayed,
// current)` for the price. See `appendEventGuarded` for the architectural note
// (single-aggregate write + definition read — not a cross-aggregate saga).
export async function emitEventGuarded<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(append: GuardedAppend<State, Event>): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    appendEventGuarded(append).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.provide(FirestoreLayerLive),
    ),
  )
}
