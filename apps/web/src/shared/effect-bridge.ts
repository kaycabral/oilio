import {
  appendEvent,
  appendEventGuarded,
  appendEventGuardedToTx,
  appendEventToTx,
  PersistencePort,
  runSaga,
  type AggregateConfig,
  type AggregateRef,
  type EventInput,
  type GuardedAppend,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { Effect } from 'effect'

export async function emitEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  ref: AggregateRef,
  input: EventInput<Event['_tag']>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    appendEvent(config, ref, input).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      // The event store runs over the Postgres `PersistencePort` — the sole
      // backend after the cutover (#1202); the OILIO_PERSISTENCE flag is gone.
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}

// Atomic use-time guard (brief 0033 AC-08/AC-09). Resolves the event payload
// from a transactional read of a definition doc (catalog-item / plan) INSIDE the
// append transaction, so a concurrent discontinuation/reprice closes the TOCTOU
// race via the Postgres tx's row locking. The `guard` reads the definition
// (locking it), rejects when discontinued, and snapshots `min(displayed,
// current)` for the price. See `appendEventGuarded` for the architectural note
// (single-aggregate write + definition read — not a cross-aggregate saga).
export async function emitEventGuarded<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(
  append: GuardedAppend<State, Event>,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  return Effect.runPromise(
    appendEventGuarded(append).pipe(
      Effect.map((envelope) => ({ ok: true as const, payload: envelope.payload })),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}

// Runs a cross-aggregate cascade as a SINGLE ACID transaction (brief 0061 §
// Grupo A / AC-02) over the Postgres layer: every step's events + projections
// commit together, or the whole tx rolls back on the first failure (a DB
// CHECK/FK/RLS refusal or a schema reject) — no partial state, no manual
// compensation. Mirrors `emitEvent`'s `{ok}` result contract so a saga call-site
// reads the same way. Postgres is the only backend post-cutover (#1202) — the
// former Firestore compensation choreography is gone.
// A DB-level refusal inside the Postgres tx (a CHECK/FK/RLS rejection, or the
// UNIQUE(aggregate_id, version) 23505 on a concurrent double-write) is thrown by
// the layer's `Effect.promise` — it surfaces as a DEFECT, not a typed failure, so
// `catchTag` misses it. Convert any such defect into the same graceful
// `{ok:false}` the typed rejects return, so a real conflict (invite double-accept,
// org-slug race, version clash) yields the caller's error path instead of an
// unhandled 500. The tx already rolled back; this only maps the outcome.
const SAGA_CONFLICT_ERROR =
  'Não foi possível concluir a operação (conflito de concorrência). Tente de novo.'
function catchSagaDefect(defect: unknown) {
  return Effect.sync(() => {
    console.error('[commitSaga] transaction defect', defect)
    return { ok: false as const, error: SAGA_CONFLICT_ERROR }
  })
}

export async function commitSaga(
  steps: readonly SagaStep[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    runSaga(steps).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchAllDefect(catchSagaDefect),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}

// Runs a GUARDED append followed by a DEPENDENT append as ONE ACID transaction
// (brief 0061 § Grupo B / AC-02: create-subscription+charge). The guard reads the
// definition (plan) in-tx and resolves the subscription payload; `buildNext` then
// derives the second event's input (the charge) from that resolved payload — so
// the charge inherits the guard's lawful price and the two commit atomically. A
// guard reject, a schema reject, or any DB refusal rolls back BOTH.
export async function commitGuardedThenAppend<
  GState extends { readonly _version: number },
  GEvent extends { readonly _tag: string },
  NState extends { readonly _version: number },
  NEvent extends { readonly _tag: string },
  NEncoded = NEvent,
>(
  guarded: GuardedAppend<GState, GEvent>,
  nextConfig: AggregateConfig<NState, NEvent, NEncoded>,
  nextRef: AggregateRef,
  buildNext: (resolvedPayload: Record<string, unknown>) => EventInput<NEvent['_tag']>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const persistence = yield* PersistencePort
      const outcome = yield* persistence.runTransaction((tx: TransactionContext) =>
        Effect.gen(function* () {
          const guardedOutcome = yield* appendEventGuardedToTx(guarded, tx)
          if (guardedOutcome._tag !== 'ok') return guardedOutcome
          yield* appendEventToTx(
            nextConfig,
            nextRef,
            buildNext(guardedOutcome.envelope.payload),
            tx,
          )
          return guardedOutcome
        }),
      )
      if (outcome._tag === 'reject') {
        return { ok: false as const, error: outcome.message }
      }
      if (outcome._tag === 'invalid') {
        return {
          ok: false as const,
          error: `Invalid event '${guarded.tag}': schema validation failed`,
        }
      }
      return { ok: true as const }
    }).pipe(
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchAllDefect(catchSagaDefect),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}
