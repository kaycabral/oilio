import { Data, Effect, Schema } from 'effect'

import type { FirestoreDoc, TransactionContext } from './services'
import { PersistencePort } from './services'

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
  // The schema's ENCODED (wire) type. Defaults to `Event` (Encoded === Decoded,
  // the common case). A schema MAY decode-normalize a legacy wire shape onto
  // `Event` — e.g. the membership `unitId` → `rlsUnitScope` rename (brief 0068
  // D4) keeps the old wire key in `Encoded` while the decoded event carries the
  // new field. The persisted payload is opaque JSON decoded via
  // `decodeUnknownEither`/`decodeEvent`, never encoded through `config.schema`.
  Encoded = Event,
> = {
  readonly type: string
  readonly initialState: State
  // The reducer receives the DECODED, schema-validated event (a discriminated
  // union on `_tag`) — no `payload as T` cast in product code. `meta` carries
  // the stream provenance (version/timestamp).
  readonly reducer: (state: State, event: Event, meta: EventMeta) => State
  readonly schema: Schema.Schema<Event, Encoded>
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
function decodeEvent<Event extends { readonly _tag: string }, Encoded = Event>(
  schema: Schema.Schema<Event, Encoded>,
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

// Appends one event + reprojection THROUGH AN EXISTING transaction context,
// without opening its own. This is the cross-aggregate-saga primitive (brief
// 0061 § Grupo A): the Postgres `runTransaction` hands the same `tx` to every
// step of a saga, so all the events + projections of a cascade commit (or roll
// back) atomically. A constraint/RLS refusal mid-cascade rolls the WHOLE tx
// back — no partial state, and no manual compensation needed (the DB's
// atomicity replaces it). `appendEvent` is the single-aggregate special case:
// it opens one tx and delegates here.
//
// Schema validation runs first (outside the tx body would still fail the whole
// Effect); a failure here aborts the enclosing tx via the Effect error channel.
export function appendEventToTx<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  aggregatePath: string,
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
  })
}

export function appendEvent<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  aggregatePath: string,
  input: EventInput<Event['_tag']>,
) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    return yield* persistence.runTransaction((tx: TransactionContext) =>
      appendEventToTx(config, aggregatePath, input, tx),
    )
  })
}

// ---------------------------------------------------------------------------
// runSaga — cross-aggregate cascade as ONE ACID transaction (brief 0061)
// ---------------------------------------------------------------------------

// The errors a saga step may raise: the schema reject from `appendEventToTx` and
// the definition-guard reject from a guarded append. A DB-level refusal (CHECK /
// FK / RLS) is not a typed error — it surfaces as a tx rollback at the Postgres
// layer boundary — so it does NOT widen this union.
export type SagaError = EventValidationError | GuardRejectedError

// A saga step runs INSIDE the shared transaction. It receives the same `tx`
// every other step gets and appends one or more aggregates' events via
// `appendEventToTx`. A step may also read intermediate projection state through
// `tx.getDoc` (e.g. to resolve the next write) — every read/write in the saga
// sees the same uncommitted snapshot, because it is one transaction.
export type SagaStep = (tx: TransactionContext) => Effect.Effect<unknown, SagaError, never>

/**
 * Runs a cross-aggregate cascade as a SINGLE ACID transaction (brief 0061 §
 * Grupo A / AC-02): every step's events + projections commit together, or — if
 * any step fails (schema reject, a DB CHECK/FK, an RLS refusal) — the WHOLE
 * transaction rolls back, leaving zero rows for every aggregate in the cascade.
 *
 * This is the Postgres replacement for the manual compensation choreography the
 * Firestore path needs (`emitUndoCompensation` & friends): the database's
 * atomicity does the undo, so there is no "emit the reverse event" code to write
 * or to get wrong. The steps run strictly in order under the same `tx`; the
 * first failure short-circuits the rest and aborts the tx.
 *
 * Firestore has no cross-aggregate transaction, so the Firestore layer's
 * `runTransaction` cannot span aggregates — sagas there stay a sequence of
 * single-aggregate `emitEvent`s with compensation (web/CLAUDE.md). `runSaga` is
 * therefore only meaningful under the Postgres layer; the caller selects the
 * path by backend (see `commitSaga` in the effect bridge).
 */
// Appends a `*.deleted` event AND hard-deletes the projection row through the
// shared tx (brief 0061 § Grupo A / AC-02, undo path): the event keeps history,
// the row removal commits/rolls back with the rest of the saga. The reducer for a
// `.deleted` event must be a no-op on the projection (the event store already
// skips the projection write for `.deleted`); this then drops the row via
// `tx.deleteDoc`. Requires a tx with `deleteDoc` (a real layer always has it).
export function appendDeleteToTx<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
  aggregatePath: string,
  input: EventInput<Event['_tag']>,
  tx: TransactionContext,
) {
  return Effect.gen(function* () {
    yield* appendEventToTx(config, aggregatePath, input, tx)
    if (tx.deleteDoc) {
      yield* tx.deleteDoc(aggregatePath)
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
// a defect at the persistence-layer tx boundary (the live layer runs the inner Effect
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

// Outcome of a guarded append, threaded through the SUCCESS channel (see the
// `GuardResult` note) so a reject/invalid is recoverable rather than collapsing
// into a defect at the live-tx boundary.
type GuardedOutcome<Tag extends string> =
  | { readonly _tag: 'reject'; readonly message: string }
  | { readonly _tag: 'invalid' }
  | { readonly _tag: 'ok'; readonly envelope: EventEnvelope<Tag> }

// The guarded-append core, running THROUGH an existing transaction context — the
// guard read + the event + the projection all share `tx`. Used both by the
// single-aggregate `appendEventGuarded` (which opens its own tx) and by a saga
// that needs a guarded write as one step of an ACID cascade (brief 0061 § Grupo
// B: create-subscription+charge — the subscription's plan-guard and the charge
// write must share one tx so the subscription is never orphaned of its charge).
export function appendEventGuardedToTx<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>(
  { config, aggregatePath, actorId, tag, guard }: GuardedAppend<State, Event>,
  tx: TransactionContext,
): Effect.Effect<GuardedOutcome<Event['_tag']>, never, never> {
  return Effect.gen(function* () {
    // Guard read happens FIRST, inside the tx, with a ROW LOCK (`getDocForUpdate`
    // → Postgres `SELECT … FOR UPDATE`) so a concurrent discontinuation/reprice
    // of the SAME definition serializes against this append (brief 0033 AC-08).
    // Falls back to `getDoc` when the tx has no locked-read (in-memory test tx —
    // no concurrency to serialize there).
    const lockedGetDoc = tx.getDocForUpdate ?? tx.getDoc
    const reader: GuardReader = {
      getDoc: <Def>(path: string, schema: Schema.Schema<Def>) =>
        lockedGetDoc(path).pipe(
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
  Encoded = Event,
>(
  config: AggregateConfig<State, Event, Encoded>,
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
  Encoded = Event,
>(config: AggregateConfig<State, Event, Encoded>, aggregatePath: string) {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort

    const eventDocs = yield* persistence.getDocs(`${aggregatePath}/events`, [
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
