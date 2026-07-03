import { unwrapPgError } from '@/shared/db/pg/unwrap-pg-error'

/**
 * The canonical categories a defect maps to before it reaches the client. Each
 * category has exactly one generic, safe user-facing message (see `messages.ts`)
 * — the classifier decides the category, the message table decides the words, and
 * the raw defect is only ever logged server-side. This is the single place that
 * answers "what does this failure mean for the caller?", so a new SQLSTATE or a
 * new error shape is one edit here, not a scattered `if` in every action.
 *
 * - `conflict`   — optimistic-concurrency clash (retriable): two writers raced
 *                  the same aggregate version. The ONLY genuinely retriable case.
 * - `integrity`  — a deterministic data-integrity refusal (FK, CHECK): the write
 *                  is well-formed but violates a relational invariant. Retrying
 *                  won't help.
 * - `forbidden`  — a row-level-security refusal: the actor's scope doesn't permit
 *                  the write. Distinct from `integrity` so the message doesn't
 *                  imply "bad data".
 * - `validation` — a schema/domain rejection surfaced as a TYPED failure
 *                  (`EventValidationError`). The raw text can carry an internal
 *                  event tag, so it never reaches the client verbatim.
 * - `unknown`    — anything else. Generic message, full detail in the log.
 */
export type ErrorCategory = 'conflict' | 'integrity' | 'forbidden' | 'validation' | 'unknown'

/** Postgres SQLSTATE for a CHECK-constraint violation (deterministic integrity). */
export const CHECK_VIOLATION = '23514'
/** Postgres SQLSTATE for a unique-constraint violation (concurrency conflict when it's the version guard). */
export const UNIQUE_VIOLATION = '23505'
/** Postgres SQLSTATE for a foreign-key violation (deterministic integrity). */
export const FOREIGN_KEY_VIOLATION = '23503'
/** Postgres SQLSTATE for an RLS / insufficient-privilege refusal. */
export const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * Classify an untyped transaction defect (post-rollback) into an `ErrorCategory`.
 *
 * The defect is inspected via `unwrapPgError`, which peels any `FiberFailure`
 * layers the Effect runtime parks a pg error under (the saga path) and reads the
 * `DatabaseError` SQLSTATE — so the classifier works whether the pg error arrives
 * bare or wrapped. Only `23505` is a retriable `conflict`; FK/CHECK are
 * deterministic `integrity`; RLS is `forbidden`; anything without a recognised
 * SQLSTATE is `unknown`.
 *
 * Typed domain failures (`EventValidationError` → `validation`) are NOT routed
 * here — the boundary maps those by their tag, because they never carry a pg
 * SQLSTATE. This function is the DB-defect classifier; `messages.ts` owns the
 * words for every category including `validation`.
 */
export function classifyError(defect: unknown): ErrorCategory {
  const { code } = unwrapPgError(defect)
  switch (code) {
    case UNIQUE_VIOLATION:
      return 'conflict'
    case FOREIGN_KEY_VIOLATION:
    case CHECK_VIOLATION:
      return 'integrity'
    case INSUFFICIENT_PRIVILEGE:
      return 'forbidden'
    default:
      return 'unknown'
  }
}
