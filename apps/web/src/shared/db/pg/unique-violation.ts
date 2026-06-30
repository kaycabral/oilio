import * as Cause from 'effect/Cause'

/**
 * Postgres SQLSTATE for a unique-constraint violation. Raised whenever a write
 * would duplicate a value guarded by a UNIQUE index — e.g. the global
 * `users_whatsapp_unique` index (one owner per WhatsApp number) or the event
 * store's `UNIQUE(aggregate_id, version)` optimistic-concurrency guard.
 */
export const UNIQUE_VIOLATION = '23505'

// A pg `DatabaseError` carries `code` (SQLSTATE) + `constraint` (the index name)
// on the bare error object.
function violationOf(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; constraint?: unknown }
  if (e.code !== UNIQUE_VIOLATION) return false
  return constraint === undefined || e.constraint === constraint
}

// When the violation surfaces through the Effect runtime it is parked under a
// `FiberFailure` (sometimes doubly-wrapped) rather than thrown bare — mirror the
// unwrap idiom in `fk-violation.ts`: squash the parked `Cause` to the underlying
// defect and re-check, following `.cause` for the bare path. Direct pool writes
// (`patchUser`/`putUser`) throw the pg error bare, so the bare check covers them;
// this keeps the helper robust if a future caller wraps the write in an Effect.
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

/**
 * True if `err` is (or wraps) a Postgres unique-constraint violation (`23505`).
 * Pass `constraint` to narrow to a specific index (e.g. `users_whatsapp_unique`)
 * so an unrelated 23505 (like the event-store version guard) isn't mistaken for
 * it. Use in server actions to convert the DB's refusal into a graceful
 * `{ ok: false }` business error instead of leaking a raw 500.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let current: unknown = err
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    if (violationOf(current, constraint)) return true
    const parked = (current as { [FIBER_FAILURE_CAUSE]?: unknown })[FIBER_FAILURE_CAUSE]
    if (Cause.isCause(parked)) {
      current = Cause.squash(parked)
      continue
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * The constraint name of the global WhatsApp uniqueness index (schema/users.ts,
 * migration 0012). Exported so callers narrow `isUniqueViolation` to exactly the
 * one-owner-per-number rule.
 */
export const USERS_WHATSAPP_UNIQUE = 'users_whatsapp_unique'
