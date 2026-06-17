import { Data, Effect, Schema } from 'effect'

import type { FirestoreDoc, TransactionContext } from './services'
import { FirestoreService } from './services'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EventValidationError extends Data.TaggedError('EventValidationError')<{
  readonly aggregateType: string
  readonly message: string
}> {}

// Raised by a transactional guard (see `appendEventGuarded`) when the definition
// read inside the append transaction fails a domain pre-condition — e.g. the
// catalog-item/plan was discontinued (`archivedAt`/`!active`) by a concurrent
// write that committed first. The append is aborted; nothing is written.
export class GuardRejectedError extends Data.TaggedError('GuardRejectedError')<{
  readonly aggregateType: string
  readonly message: string
}> {}

export class ReplayInconsistencyError extends Data.TaggedError('ReplayInconsistencyError')<{
  readonly aggregateType: string
  readonly aggregatePath: string
  readonly expectedVersion: number
  readonly actualVersion: number
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// Per-event provenance handed to a reducer alongside the decoded event. The
// reducer derives `_version`/`updatedAt` from `version`/`timestamp` — never from
// the payload — so the projection's version always tracks the stream.
export type EventMeta = {
  readonly version: number
  readonly timestamp: string
  readonly actorId: string
  readonly schemaVersion: number
}

export type AggregateConfig<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
> = {
  readonly type: string
  readonly initialState: State
  // The reducer receives the DECODED, schema-validated event (a discriminated
  // union on `_tag`) — no `payload as T` cast in product code. `meta` carries
  // the stream provenance (version/timestamp).
  readonly reducer: (state: State, event: Event, meta: EventMeta) => State
  readonly schema: Schema.Schema<Event>
  readonly currentSchemaVersion: number
  readonly upcasters?: Readonly<Record<number, (raw: EventEnvelope) => EventEnvelope>>
}

// Reads `_version` off an untyped projection doc without asserting its shape.
function projectionVersion(doc: FirestoreDoc | null): number {
  const v = doc?.['_version']
  return typeof v === 'number' ? v : 0
}

// Shape of a persisted event doc (`{aggregate}/events/v…`). Decoding the raw
// FirestoreDoc against this yields a typed `EventEnvelope` without a cast.
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

// Decodes the persisted envelope's event body (`{ _tag, ...payload }`) against
// the aggregate schema, yielding the typed event the reducer narrows on.
function decodeEvent<Event extends { readonly _tag: string }>(
  schema: Schema.Schema<Event>,
  envelope: EventEnvelope,
): Event {
  return Schema.decodeUnknownSync(schema)({ _tag: envelope._tag, ...envelope.payload })
}

// Rehydrates a typed projection from an untyped doc by layering it over the
// aggregate's initial state — present fields override defaults, missing ones
// keep them. `Object.assign` preserves the target's `State` type, so no cast.
function rehydrateState<State extends { readonly _version: number }>(
  initialState: State,
  doc: FirestoreDoc | null,
): State {
  return doc ? Object.assign({ ...initialState }, doc) : initialState
}

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

export function appendEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(config: AggregateConfig<State, Event>, aggregatePath: string, input: EventInput<Event['_tag']>) {
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

    const firestore = yield* FirestoreService

    return yield* firestore.runTransaction((tx: TransactionContext) =>
      Effect.gen(function* () {
        const projectionDoc = yield* tx.getDoc(aggregatePath)

        const envelope: EventEnvelope<Event['_tag']> = {
          _tag: input._tag,
          version: projectionVersion(projectionDoc) + 1,
          timestamp: new Date().toISOString(),
          actorId: input.actorId,
          schemaVersion: config.currentSchemaVersion,
          payload: input.payload,
        }

        const eventId = `v${String(envelope.version).padStart(6, '0')}`
        yield* tx.setDoc(`${aggregatePath}/events/${eventId}`, envelope)

        const currentState = rehydrateState(config.initialState, projectionDoc)
        const newState = config.reducer(currentState, decodeResult.right, envelope)

        // Eventos `.deleted` são hard-delete: o caller remove a projeção via
        // `.doc().delete()`. NÃO reprojetar — senão o `setDoc` "ressuscita" o
        // doc com o estado do reducer e o delete nunca cola. O evento já foi
        // gravado acima (histórico preservado na subcollection `events`).
        if (!input._tag.endsWith('.deleted')) {
          yield* tx.setDoc(aggregatePath, newState)
        }

        return envelope
      }),
    )
  })
}

// ---------------------------------------------------------------------------
// appendEventGuarded
// ---------------------------------------------------------------------------

// Like `appendEvent`, but resolves the event payload from a transactional read
// of an external *definition* doc (catalog-item / subscription-plan), INSIDE the
// same transaction that appends the event + projection. This closes the
// discontinuation/reprice TOCTOU race (brief 0033 AC-08): the guard reads the
// definition via `tx.getDoc` — a transactional read that locks the doc — so a
// concurrent discontinuation/reprice that commits first forces this transaction
// to retry and re-read fresh state, where the guard then rejects (archived) or
// re-snapshots the (possibly changed) price.
//
// This does NOT violate the saga rule: we WRITE a single aggregate (the order /
// subscription event + its projection) and only READ the definition to guard
// and snapshot — reading a definition to guard the ONE aggregate's write is the
// sanctioned pattern (see web/CLAUDE.md § "cascata = saga").
//
// The `guard` runs inside the tx, receives a transactional reader, and returns
// either the resolved `payload` (snapshotted from the committed definition
// state) or a `GuardRejectedError` (e.g. discontinued). `EventValidationError`
// (schema) still applies after the payload is resolved.
// Typed transactional reader handed to the guard. `getDoc(path, schema)` decodes
// the untyped `FirestoreDoc` against `schema` (or returns `null`) — schema-
// validated, so no cast and product code stays cast-free.
export type GuardReader = {
  readonly getDoc: <Def>(
    path: string,
    schema: Schema.Schema<Def>,
  ) => Effect.Effect<Def | null, never, never>
}

// The guard returns either a resolved `payload` (snapshotted from the committed
// definition) or a `reject` message (e.g. discontinued). It does NOT fail the
// Effect: a typed failure raised INSIDE the live `runTransaction` collapses into
// a defect at the firestore-tx boundary (the live layer runs the inner Effect
// via `runPromise`, so a rejection isn't a recoverable typed error). Threading
// the rejection through the SUCCESS channel keeps it recoverable while still
// aborting the write (the tx returns early without setting any doc).
export type GuardResult =
  | { readonly _tag: 'ok'; readonly payload: Record<string, unknown> }
  | { readonly _tag: 'reject'; readonly message: string }

export type GuardedAppend<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
> = {
  readonly config: AggregateConfig<State, Event>
  readonly aggregatePath: string
  readonly actorId: string
  readonly tag: Event['_tag']
  readonly guard: (reader: GuardReader) => Effect.Effect<GuardResult, never, never>
}

export function appendEventGuarded<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>({ config, aggregatePath, actorId, tag, guard }: GuardedAppend<State, Event>) {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService

    const outcome = yield* firestore.runTransaction((tx: TransactionContext) =>
      Effect.gen(function* () {
        // Guard read happens FIRST, inside the tx — locks the definition doc so a
        // concurrent discontinuation/reprice serializes against this append.
        const reader: GuardReader = {
          getDoc: <Def>(path: string, schema: Schema.Schema<Def>) =>
            tx
              .getDoc(path)
              .pipe(Effect.map((d) => (d === null ? null : Schema.decodeUnknownSync(schema)(d)))),
        }
        const guarded = yield* guard(reader)
        if (guarded._tag === 'reject') {
          // Abort: return early without writing. The tx commits a no-op.
          return { _tag: 'reject' as const, message: guarded.message }
        }

        const decodeResult = Schema.decodeUnknownEither(config.schema)({
          _tag: tag,
          ...guarded.payload,
        })
        if (decodeResult._tag === 'Left') {
          return { _tag: 'invalid' as const }
        }

        const projectionDoc = yield* tx.getDoc(aggregatePath)

        const envelope: EventEnvelope<Event['_tag']> = {
          _tag: tag,
          version: projectionVersion(projectionDoc) + 1,
          timestamp: new Date().toISOString(),
          actorId,
          schemaVersion: config.currentSchemaVersion,
          payload: guarded.payload,
        }

        const eventId = `v${String(envelope.version).padStart(6, '0')}`
        yield* tx.setDoc(`${aggregatePath}/events/${eventId}`, envelope)

        const currentState = rehydrateState(config.initialState, projectionDoc)
        const newState = config.reducer(currentState, decodeResult.right, envelope)
        yield* tx.setDoc(aggregatePath, newState)

        return { _tag: 'ok' as const, envelope }
      }),
    )

    if (outcome._tag === 'reject') {
      return yield* Effect.fail(
        new GuardRejectedError({ aggregateType: config.type, message: outcome.message }),
      )
    }
    if (outcome._tag === 'invalid') {
      return yield* Effect.fail(
        new EventValidationError({
          aggregateType: config.type,
          message: `Invalid event '${tag}': schema validation failed`,
        }),
      )
    }
    return outcome.envelope
  })
}

// ---------------------------------------------------------------------------
// buildInitialEvent
// ---------------------------------------------------------------------------

// Projeta o PRIMEIRO evento (version 1) de um aggregate novo, de forma síncrona
// e sem ler o store — pra ser embutido numa transação que o caller já controla
// (ex.: o guard transacional anti-double-book do booking, que faz range-query e
// não cabe no `TransactionContext` enxuto do effect-layer). O caller grava o
// `envelope` em `events/${eventId}` e a `projection` no doc do aggregate, na sua
// própria transação — mantendo event-first (evento é a fonte; projeção derivada)
// sem o dual-write de escrever o doc operacional direto.
//
// Só pra aggregate NOVO (version determinística = 1). Eventos subsequentes vão
// pelo `appendEvent` normal (que lê a versão corrente).
export function buildInitialEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(
  config: AggregateConfig<State, Event>,
  input: EventInput<Event['_tag']>,
): {
  readonly envelope: EventEnvelope<Event['_tag']>
  readonly eventId: string
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
  const eventId = `v${String(envelope.version).padStart(6, '0')}`
  const projection = config.reducer(config.initialState, decodeResult.right, envelope)
  return { envelope, eventId, projection }
}

// ---------------------------------------------------------------------------
// replayAggregate
// ---------------------------------------------------------------------------

export function replayAggregate<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(config: AggregateConfig<State, Event>, aggregatePath: string) {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService

    const eventDocs = yield* firestore.getDocs(`${aggregatePath}/events`, [
      { kind: 'orderBy', field: 'version', direction: 'asc' },
    ])

    let state = config.initialState
    for (const doc of eventDocs) {
      let envelope = decodeEnvelope(doc)

      if (envelope.schemaVersion < config.currentSchemaVersion && config.upcasters) {
        for (let v = envelope.schemaVersion; v < config.currentSchemaVersion; v++) {
          const upcaster = config.upcasters[v]
          if (upcaster) {
            envelope = upcaster(envelope)
          }
        }
      }

      state = config.reducer(state, decodeEvent(config.schema, envelope), envelope)
    }

    return state
  })
}
