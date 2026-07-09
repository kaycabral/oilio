import { FOREIGN_KEY_VIOLATION } from '@/shared/db/pg/fk-violation'
import { UNIQUE_VIOLATION } from '@/shared/db/pg/unique-violation'
import { unwrapPgError } from '@/shared/db/pg/unwrap-pg-error'

export type ErrorCategory = 'conflict' | 'integrity' | 'forbidden' | 'validation' | 'unknown'

export const CHECK_VIOLATION = '23514'
export const EXCLUSION_VIOLATION = '23P01'
export const INSUFFICIENT_PRIVILEGE = '42501'

export function classifyError(defect: unknown): ErrorCategory {
  const { code } = unwrapPgError(defect)
  switch (code) {
    case UNIQUE_VIOLATION:
      return 'conflict'
    case FOREIGN_KEY_VIOLATION:
    case CHECK_VIOLATION:
    case EXCLUSION_VIOLATION:
      return 'integrity'
    case INSUFFICIENT_PRIVILEGE:
      return 'forbidden'
    default:
      return 'unknown'
  }
}
