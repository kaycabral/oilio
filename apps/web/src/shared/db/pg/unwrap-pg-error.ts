import * as Cause from 'effect/Cause'

/**
 * The private symbol under which an Effect `FiberFailure` parks the original
 * `Cause`. A pg error raised inside the Postgres layer does NOT arrive bare: the
 * layer's `runTransaction` runs the inner Effect via `Effect.runPromise`, which
 * rejects with a `FiberFailure`, and the outer `Effect.promise` then dies with
 * THAT — so the defect the boundary sees is a `FiberFailure` (sometimes nested
 * twice). `FiberFailure` doesn't expose the original error on `.cause`; it parks
 * the `Cause` here.
 */
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

/**
 * The shape a pg `DatabaseError` carries on the bare error object: `code` is the
 * SQLSTATE, `constraint` the offending index/constraint name (present on unique,
 * FK, CHECK and exclusion violations).
 */
export type PgErrorShape = {
  readonly code?: string
  readonly constraint?: string
}

/**
 * Walk `err` down to the underlying pg `DatabaseError` and return its `code` +
 * `constraint`, unwrapping any `FiberFailure` layers on the way. Returns an empty
 * shape when `err` is not (and does not wrap) a pg error.
 *
 * This is the single home of the FiberFailure-unwrapping idiom that
 * `unique-violation`, `fk-violation` and `commit-appointment` used to each
 * re-implement. Two write paths surface pg errors two ways — direct pool writes
 * (`patchUser`/`putUser`, `deletePostgresProjection`) throw the pg error bare,
 * while event-store / saga writes park it under a `FiberFailure` — and this walk
 * covers both: it checks the current value, then follows the parked `Cause`
 * (squashing, since a doubly-wrapped failure squashes to another `FiberFailure`)
 * and finally a plain `.cause`.
 */
export function unwrapPgError(err: unknown): PgErrorShape {
  let current: unknown = err
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const { code, constraint } = current as { code?: unknown; constraint?: unknown }
    if (typeof code === 'string') {
      return {
        code,
        constraint: typeof constraint === 'string' ? constraint : undefined,
      }
    }
    const parked = (current as { [FIBER_FAILURE_CAUSE]?: unknown })[FIBER_FAILURE_CAUSE]
    if (Cause.isCause(parked)) {
      current = Cause.squash(parked)
      continue
    }
    current = (current as { cause?: unknown }).cause
  }
  return {}
}
