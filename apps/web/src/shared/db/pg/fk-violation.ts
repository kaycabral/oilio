import { unwrapPgError } from '@/shared/db/pg/unwrap-pg-error'

/**
 * Postgres SQLSTATE for a foreign-key violation. Raised when a hard-delete of a
 * parent projection row is refused by an `ON DELETE RESTRICT` cross-aggregate FK
 * (brief 0068 D2): deleting a unit/customer/memberOperation/catalog-item/subscription
 * that still has dependent rows (orders, charges, appointments, …).
 */
export const FOREIGN_KEY_VIOLATION = '23503'

/**
 * True if `err` is (or wraps) a Postgres foreign-key violation (`23503`). Use in
 * delete server actions to convert the DB's RESTRICT refusal into a graceful
 * `{ ok: false }` result instead of leaking a raw 500 (brief 0068 AC-02). The
 * FiberFailure-unwrapping (the hard-delete path throws bare; a saga path parks
 * the pg error under a `FiberFailure`) lives in `unwrapPgError`.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return unwrapPgError(err).code === FOREIGN_KEY_VIOLATION
}
