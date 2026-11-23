import { pgErrorOf } from '@/shared/db/pg/pg-error'
import { PG_ERROR } from '@cbrl/pg'

export type ErrorCategory = 'conflict' | 'integrity' | 'forbidden' | 'validation' | 'unknown'

export const INSUFFICIENT_PRIVILEGE = '42501'

export function classifyError(defect: unknown): ErrorCategory {
  const { code } = pgErrorOf(defect)
  switch (code) {
    case PG_ERROR.UNIQUE_VIOLATION:
      return 'conflict'
    case PG_ERROR.FOREIGN_KEY_VIOLATION:
    case PG_ERROR.CHECK_VIOLATION:
    case PG_ERROR.EXCLUSION_VIOLATION:
      return 'integrity'
    case INSUFFICIENT_PRIVILEGE:
      return 'forbidden'
    default:
      return 'unknown'
  }
}
