import { unwrapPgError } from '@/shared/db/pg/unwrap-pg-error'

export const UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = unwrapPgError(err)
  if (pg.code !== UNIQUE_VIOLATION) return false
  return constraint === undefined || pg.constraint === constraint
}

export const USERS_MOBILE_UNIQUE = 'users_mobile_unique'
