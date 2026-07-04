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

/**
 * The acting subject's RLS scope for a write (brief 0075, #1265). When a
 * self-scoped member operates, the action resolves their `memberOperationId` (the
 * own-scope id — same value the read path passes as `app.current_member_operation`)
 * and threads it here; the bridge provides a `SecurityContext` so the own-scope
 * policies enforce own-only on the WRITE (the WITH CHECK refuses a colleague's row
 * at the DB). Omitted (or `memberOperationId` empty) = balcão: permissive, the
 * pre-#1265 behaviour every existing call-site keeps unchanged.
 */
export type WriteSecurity = {
  readonly orgId: string
  readonly unitId?: string | null
  readonly memberOperationId?: string | null
}

// Build the optional SecurityContext layer; `Layer.empty` when no scope is given,
// so a balcão write provides nothing and the GUC stays permissive (`''`).
// Exported so direct event-store writers that don't go through `emitEvent`
// (`commitAppointmentBooking` — the anti-double-book commit) share the EXACT same
// own-scope wiring instead of re-deriving it (DRY: one place builds the
// `SecurityContext` from a `WriteSecurity`, so the two write paths can't drift).
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
        // A schema-validation reject's raw text can carry the internal event tag
        // ("Invalid event '<tag>': schema validation failed"); the client gets the
        // generic `validation` message instead. The typed error is still the log's.
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      // A DB refusal (23xxx / FK / CHECK / RLS thrown by the layer's
      // `Effect.promise`) surfaces as a DEFECT, not a typed failure, so the
      // `catchTag` above misses it and it would escape `runPromise` as a raw 500.
      // Map it to the same graceful `{ok:false}` the typed rejects return — the
      // net the saga writers already have (#1344). Call-sites that check `.ok`
      // (audited: all but the ones fixed alongside this) surface the honest
      // category message; the raw defect is logged, never sent to the client.
      Effect.catchAllDefect(catchWriteDefect),
      // The event store runs over the Postgres `PersistencePort` — the sole
      // backend after the cutover (#1202); the OILIO_PERSISTENCE flag is gone.
      // `securityLayer` supplies own-scope RLS when the actor is self-scoped (#1265);
      // empty otherwise (balcão), so the GUC stays permissive.
      Effect.provide(Layer.merge(PostgresPersistenceLayer, securityLayer(security))),
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
      Effect.catchTag('EventValidationError', () =>
        // A schema-validation reject's raw text can carry the internal event tag
        // ("Invalid event '<tag>': schema validation failed"); the client gets the
        // generic `validation` message instead. The typed error is still the log's.
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      // Same DB-defect net as `emitEvent` (#1344): a raw refusal escaping the
      // tags above maps to `{ok:false}` instead of a 500. Preserves both tags —
      // it only catches what neither `catchTag` did.
      Effect.catchAllDefect(catchWriteDefect),
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
// A DB refusal that rolls the tx back is classified by the canonical error
// contract (`classifyError` → category → generic message): a 23505 version clash
// is the ONLY retriable `conflict` (two writers raced the same aggregate version);
// FK/CHECK are deterministic `integrity`, RLS is `forbidden`, the rest `unknown`.
// "Tente de novo" for a deterministic refusal would be a lie and hide a real bug
// behind a flake-shaped message (#1320) — the contract keeps the honest wording
// per category. The raw defect is logged server-side; the client only ever sees
// the generic message (no SQLSTATE / constraint name / stack).
// Shared by the saga writers (commitSaga / commitGuardedThenAppend) AND the
// single-aggregate writers (emitEvent / emitEventGuarded, #1344): a DB refusal
// that escapes the typed `catchTag`s is logged raw server-side and mapped to the
// generic per-category message, so the client never sees a SQLSTATE/constraint.
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
        // A schema-validation reject's raw text can carry the internal event tag
        // ("Invalid event '<tag>': schema validation failed"); the client gets the
        // generic `validation` message instead. The typed error is still the log's.
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchTag('GuardRejectedError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.catchAllDefect(catchWriteDefect),
      // Own-scope RLS for a self-scoped saga actor (#1265); empty for the balcão.
      Effect.provide(Layer.merge(PostgresPersistenceLayer, securityLayer(security))),
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
        // A guard REJECT is a domain business rule ("discontinued", "plan full"):
        // the message is curated by the domain, is meant for the user, and carries
        // no technical detail — so the contract preserves it verbatim. (The trust
        // boundary is the message's ORIGIN — domain-authored, not infra — not the
        // error's type. See ADR 0015.)
        return { ok: false as const, error: outcome.message }
      }
      if (outcome._tag === 'invalid') {
        // A schema INVALID would expose the internal event tag; generic instead.
        return { ok: false as const, error: messageForCategory('validation') }
      }
      return { ok: true as const }
    }).pipe(
      Effect.catchTag('EventValidationError', () =>
        // A schema-validation reject's raw text can carry the internal event tag
        // ("Invalid event '<tag>': schema validation failed"); the client gets the
        // generic `validation` message instead. The typed error is still the log's.
        Effect.succeed({ ok: false as const, error: messageForCategory('validation') }),
      ),
      Effect.catchAllDefect(catchWriteDefect),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}
