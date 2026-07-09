import {
  appendEvent,
  appendEventGuarded,
  appendEventGuardedToTx,
  appendEventToTx,
  PersistencePort,
  runSaga,
  SecurityContext,
  type AggregateConfig,
  type AggregateRef,
  type EventInput,
  type GuardedAppend,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { classifyError } from '@/shared/errors/classify'
import { messageForCategory } from '@/shared/errors/messages'
import { logger } from '@/shared/lib/logger'
import { Effect, Layer } from 'effect'

export type WriteSecurity = {
  readonly orgId: string
  readonly unitId?: string | null
  readonly memberOperationId?: string | null
}

export function securityLayer(security?: WriteSecurity): Layer.Layer<never> {
  if (!security) return Layer.empty
  return Layer.succeed(SecurityContext, {
    orgId: security.orgId,
    unitId: security.unitId ?? null,
    memberOperationId: security.memberOperationId ?? null,
  })
}

export async function emitEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  ref: AggregateRef,
  input: EventInput<Event['_tag']>,
  security?: WriteSecurity,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    appendEvent(config, ref, input).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', () =>
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchAllDefect(catchWriteDefect),
      Effect.provide(Layer.merge(PostgresPersistenceLayer, securityLayer(security))),
    ),
  )
}

export async function emitEventGuarded<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(
  append: GuardedAppend<State, Event>,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  return Effect.runPromise(
    appendEventGuarded(append).pipe(
      Effect.map((envelope) => ({ ok: true as const, payload: envelope.payload })),
      Effect.catchTag('EventValidationError', () =>
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchAllDefect(catchWriteDefect),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}

function catchWriteDefect(defect: unknown) {
  return Effect.sync(() => {
    logger.error('write defect', { scope: 'effect-bridge', defect })
    return { ok: false as const, error: messageForCategory(classifyError(defect)) }
  })
}

export async function commitSaga(
  steps: readonly SagaStep[],
  security?: WriteSecurity,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return Effect.runPromise(
    runSaga(steps).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', () =>
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchAllDefect(catchWriteDefect),
      Effect.provide(Layer.merge(PostgresPersistenceLayer, securityLayer(security))),
    ),
  )
}

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
        return { ok: false as const, error: messageForCategory('validation') }
      }
      return { ok: true as const }
    }).pipe(
      Effect.catchTag('EventValidationError', () =>
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchAllDefect(catchWriteDefect),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}
