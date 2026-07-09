import { unwrapPgError } from '@/shared/db/pg/unwrap-pg-error'

export const FOREIGN_KEY_VIOLATION = '23503'

export function isForeignKeyViolation(err: unknown): boolean {
  return unwrapPgError(err).code === FOREIGN_KEY_VIOLATION
}
