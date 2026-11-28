import {
  isForeignKeyViolation as isForeignKeyViolationIn,
  isUniqueViolation as isUniqueViolationIn,
  pgErrorOf as pgErrorOfIn,
  type PgErrorShape,
} from '@cbrl/pg'

export const USERS_MOBILE_UNIQUE = 'users_mobile_unique'

export function pgErrorOf(err: unknown): PgErrorShape {
  return pgErrorOfIn(err)
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return isUniqueViolationIn(err, constraint)
}

export function isForeignKeyViolation(err: unknown): boolean {
  return isForeignKeyViolationIn(err)
}
