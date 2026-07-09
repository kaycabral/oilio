import { Data, Effect, Schema } from 'effect'

import type { AggregateRef, AggregateType } from './aggregate-ref'
import type { FirestoreDoc, TransactionContext } from './services'
import { PersistencePort } from './services'

export class EventValidationError extends Data.TaggedError('EventValidationError')<{
  readonly aggregateType: string
  readonly message: string
}> {}

export class GuardRejectedError extends Data.TaggedError('GuardRejectedError')<{
  readonly aggregateType: string
  readonly message: string
}> {}

export class ReplayInconsistencyError extends Data.TaggedError('ReplayInconsistencyError')<{
  readonly aggregateType: string
  readonly orgId: string
  readonly aggregateId: string
  readonly expectedVersion: number
  readonly actualVersion: number
}> {}

export type EventEnvelope<Tag extends string = string, Payload = Record<string, unknown>> = {
  readonly _tag: Tag
  readonly version: number
  readonly timestamp: string
  readonly actorId: string
  readonly schemaVersion: number
  readonly payload: Payload
}

export type EventInput<Tag extends string = string, Payload = Record<string, unknown>> = {
  readonly _tag: Tag
  readonly actorId: string
  readonly payload: Payload
}

export type EventMeta = {
  readonly version: number
  readonly timestamp: string
  readonly actorId: string
  readonly schemaVersion: number
}

export type AggregateConfig<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
> = {
  readonly type: AggregateType
  readonly initialState: State
  readonly reducer: (state: State, event: Event, meta: EventMeta) => State
  readonly schema: Schema.Schema<Event, Encoded>
  readonly currentSchemaVersion: number
  readonly upcasters?: Readonly<Record<number, (raw: EventEnvelope) => EventEnvelope>>
}

function projectionVersion(doc: FirestoreDoc | null): number {
  const v = doc?.['_version']
  return typeof v === 'number' ? v : 0
}

const EnvelopeSchema = Schema.Struct({
  _tag: Schema.String,
  version: Schema.Number,
  timestamp: Schema.String,
  actorId: Schema.String,
  schemaVersion: Schema.Number,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

function decodeEnvelope(doc: FirestoreDoc): EventEnvelope {
  return Schema.decodeUnknownSync(EnvelopeSchema)(doc)
}

function decodeEvent<Event extends { readonly _tag: string }, Encoded = Event>(
  schema: Schema.Schema<Event, Encoded>,
  envelope: EventEnvelope,
): Event {
  return Schema.decodeUnknownSync(schema)({ _tag: envelope._tag, ...envelope.payload })
}

function upcastEnvelope<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(config: AggregateConfig<State, Event, Encoded>, envelope: EventEnvelope): EventEnvelope {
  if (envelope.schemaVersion >= config.currentSchemaVersion || !config.upcasters) return envelope
  let lifted = envelope
  for (let v = lifted.schemaVersion; v < config.currentSchemaVersion; v++) {
    const upcaster = config.upcasters[v]
    if (upcaster) lifted = upcaster(lifted)
  }
  return lifted
}

export function decodeStreamEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(config: AggregateConfig<State, Event, Encoded>, doc: FirestoreDoc): Event {
  return decodeEvent(config.schema, upcastEnvelope(config, decodeEnvelope(doc)))
}

function rehydrateState<State extends { readonly _version: number }>(
  initialState: State,
  doc: FirestoreDoc | null,
): State {
  return doc ? Object.assign({ ...initialState }, doc) : initialState
}

export function appendEventToTx<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  ref: AggregateRef,
  input: EventInput<Event['_tag']>,
  tx: TransactionContext,
) {
  return Effect.gen(function* () {
    const decodeResult = Schema.decodeUnknownEither(config.schema)({
      _tag: input._tag,
      ...input.payload,
    })
    if (decodeResult._tag === 'Left') {
      return yield* Effect.fail(
        new EventValidationError({
          aggregateType: config.type,
          message: `Invalid event '${input._tag}': schema validation failed`,
        }),
      )
    }

    const projectionDoc = yield* tx.getDoc(ref)

    const envelope: EventEnvelope<Event['_tag']> = {
      _tag: input._tag,
      version: projectionVersion(projectionDoc) + 1,
      timestamp: new Date().toISOString(),
      actorId: input.actorId,
      schemaVersion: config.currentSchemaVersion,
      payload: input.payload,
    }

    if (tx.appendEvent) {
      yield* tx.appendEvent(ref, envelope.version, envelope)
    }

    const currentState = rehydrateState(config.initialState, projectionDoc)
    const newState = config.reducer(currentState, decodeResult.right, envelope)

    if (!input._tag.endsWith('.deleted')) {
      yield* tx.setDoc(ref, newState)
    }

    return envelope
  })
}

export function appendEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  ref: AggregateRef,
  input: EventInput<Event['_tag']>,
) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    return yield* persistence.runTransaction((tx: TransactionContext) =>
      appendEventToTx(config, ref, input, tx),
    )
  })
}

export type SagaError = EventValidationError | GuardRejectedError

export type SagaStep = (tx: TransactionContext) => Effect.Effect<unknown, SagaError, never>

export function appendDeleteToTx<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  ref: AggregateRef,
  input: EventInput<Event['_tag']>,
  tx: TransactionContext,
) {
  return Effect.gen(function* () {
    yield* appendEventToTx(config, ref, input, tx)
    if (tx.deleteDoc) {
      yield* tx.deleteDoc(ref)
    }
  })
}

export function runSaga(steps: readonly SagaStep[]) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    return yield* persistence.runTransaction((tx: TransactionContext) =>
      Effect.gen(function* () {
        for (const step of steps) {
          yield* step(tx)
        }
      }),
    )
  })
}

export type GuardReader = {
  readonly getDoc: <Def>(
    ref: AggregateRef,
    schema: Schema.Schema<Def>,
  ) => Effect.Effect<Def | null, never, never>
}

export type GuardResult =
  | { readonly _tag: 'ok'; readonly payload: Record<string, unknown> }
  | { readonly _tag: 'reject'; readonly message: string }

export type GuardedAppend<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
> = {
  readonly config: AggregateConfig<State, Event>
  readonly ref: AggregateRef
  readonly actorId: string
  readonly tag: Event['_tag']
  readonly guard: (reader: GuardReader) => Effect.Effect<GuardResult, never, never>
}

type GuardedOutcome<Tag extends string> =
  | { readonly _tag: 'reject'; readonly message: string }
  | { readonly _tag: 'invalid' }
  | { readonly _tag: 'ok'; readonly envelope: EventEnvelope<Tag> }

export function appendEventGuardedToTx<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(
  { config, ref, actorId, tag, guard }: GuardedAppend<State, Event>,
  tx: TransactionContext,
): Effect.Effect<GuardedOutcome<Event['_tag']>, never, never> {
  return Effect.gen(function* () {
    const lockedGetDoc = tx.getDocForUpdate ?? tx.getDoc
    const reader: GuardReader = {
      getDoc: <Def>(defRef: AggregateRef, schema: Schema.Schema<Def>) =>
        lockedGetDoc(defRef).pipe(
          Effect.map((d) => (d === null ? null : Schema.decodeUnknownSync(schema)(d))),
        ),
    }
    const guarded = yield* guard(reader)
    if (guarded._tag === 'reject') {
      return { _tag: 'reject' as const, message: guarded.message }
    }

    const decodeResult = Schema.decodeUnknownEither(config.schema)({
      _tag: tag,
      ...guarded.payload,
    })
    if (decodeResult._tag === 'Left') {
      return { _tag: 'invalid' as const }
    }

    const projectionDoc = yield* tx.getDoc(ref)

    const envelope: EventEnvelope<Event['_tag']> = {
      _tag: tag,
      version: projectionVersion(projectionDoc) + 1,
      timestamp: new Date().toISOString(),
      actorId,
      schemaVersion: config.currentSchemaVersion,
      payload: guarded.payload,
    }

    if (tx.appendEvent) {
      yield* tx.appendEvent(ref, envelope.version, envelope)
    }

    const currentState = rehydrateState(config.initialState, projectionDoc)
    const newState = config.reducer(currentState, decodeResult.right, envelope)
    yield* tx.setDoc(ref, newState)

    return { _tag: 'ok' as const, envelope }
  })
}

export function appendEventGuarded<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(append: GuardedAppend<State, Event>) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    const outcome = yield* persistence.runTransaction((tx: TransactionContext) =>
      appendEventGuardedToTx(append, tx),
    )
    if (outcome._tag === 'reject') {
      return yield* Effect.fail(
        new GuardRejectedError({ aggregateType: append.config.type, message: outcome.message }),
      )
    }
    if (outcome._tag === 'invalid') {
      return yield* Effect.fail(
        new EventValidationError({
          aggregateType: append.config.type,
          message: `Invalid event '${append.tag}': schema validation failed`,
        }),
      )
    }
    return outcome.envelope
  })
}

export function buildInitialEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  input: EventInput<Event['_tag']>,
): {
  readonly envelope: EventEnvelope<Event['_tag']>
  readonly projection: State
} {
  const decodeResult = Schema.decodeUnknownEither(config.schema)({
    _tag: input._tag,
    ...input.payload,
  })
  if (decodeResult._tag === 'Left') {
    throw new EventValidationError({
      aggregateType: config.type,
      message: `Invalid event '${input._tag}': schema validation failed`,
    })
  }

  const envelope: EventEnvelope<Event['_tag']> = {
    _tag: input._tag,
    version: 1,
    timestamp: new Date().toISOString(),
    actorId: input.actorId,
    schemaVersion: config.currentSchemaVersion,
    payload: input.payload,
  }
  const projection = config.reducer(config.initialState, decodeResult.right, envelope)
  return { envelope, projection }
}

export function replayAggregate<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(config: AggregateConfig<State, Event, Encoded>, ref: AggregateRef) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort

    const eventDocs = yield* persistence.getEvents(ref)

    let state = config.initialState
    for (const doc of eventDocs) {
      const envelope = upcastEnvelope(config, decodeEnvelope(doc))
      state = config.reducer(state, decodeEvent(config.schema, envelope), envelope)
    }

    return state
  })
}
