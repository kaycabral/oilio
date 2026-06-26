import * as Cause from 'effect/Cause'

/**
 * Postgres SQLSTATE for a foreign-key violation. Raised when a hard-delete of a
 * parent projection row is refused by an `ON DELETE RESTRICT` cross-aggregate FK
 * (brief 0068 D2): deleting a unit/customer/professional/catalog-item/subscription
 * that still has dependent rows (orders, charges, appointments, …).
 */
export const FOREIGN_KEY_VIOLATION = '23503'

// A pg `DatabaseError` carries `code` (SQLSTATE) on the bare error object.
function hasForeignKeyViolationCode(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  return (err as { code?: unknown }).code === FOREIGN_KEY_VIOLATION
}

// When the FK error surfaces through the Effect runtime it is parked under a
// `FiberFailure` (sometimes doubly-wrapped) rather than thrown bare — mirror the
// unwrap idiom in `commit-appointment.ts`: squash the parked `Cause` to the
// underlying defect and re-check, following `.cause` for the bare path. The
// hard-delete path (`deletePostgresProjection`) throws the pg error directly, so
// the bare check covers it; this keeps the helper robust if a future caller wraps
// the delete in an Effect.
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

/**
 * True if `err` is (or wraps) a Postgres foreign-key violation (`23503`). Use in
 * delete server actions to convert the DB's RESTRICT refusal into a graceful
 * `{ ok: false }` result instead of leaking a raw 500 (brief 0068 AC-02).
 */
export function isForeignKeyViolation(err: unknown): boolean {
  let current: unknown = err
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    if (hasForeignKeyViolationCode(current)) return true
    const parked = (current as { [FIBER_FAILURE_CAUSE]?: unknown })[FIBER_FAILURE_CAUSE]
    if (Cause.isCause(parked)) {
      current = Cause.squash(parked)
      continue
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}
