import { unwrapPgError } from '@/shared/db/pg/unwrap-pg-error'

/**
 * Postgres SQLSTATE for a unique-constraint violation. Raised whenever a write
 * would duplicate a value guarded by a UNIQUE index — e.g. the global
 * `users_mobile_unique` index (one owner per mobile number) or the event
 * store's `UNIQUE(aggregate_id, version)` optimistic-concurrency guard.
 */
export const UNIQUE_VIOLATION = '23505'

/**
 * True if `err` is (or wraps) a Postgres unique-constraint violation (`23505`).
 * Pass `constraint` to narrow to a specific index (e.g. `users_mobile_unique`)
 * so an unrelated 23505 (like the event-store version guard) isn't mistaken for
 * it. Use in server actions to convert the DB's refusal into a graceful
 * `{ ok: false }` business error instead of leaking a raw 500. The
 * FiberFailure-unwrapping (the event-store/saga path parks the pg error under a
 * `FiberFailure`; direct pool writes throw it bare) lives in `unwrapPgError`.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = unwrapPgError(err)
  if (pg.code !== UNIQUE_VIOLATION) return false
  return constraint === undefined || pg.constraint === constraint
}

/**
 * The constraint name of the global mobile uniqueness index (schema/users.ts,
 * migration 0012). Exported so callers narrow `isUniqueViolation` to exactly the
 * one-owner-per-number rule.
 */
export const USERS_MOBILE_UNIQUE = 'users_mobile_unique'
