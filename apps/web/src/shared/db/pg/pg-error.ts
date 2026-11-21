import {
  isForeignKeyViolation as isForeignKeyViolationIn,
  isUniqueViolation as isUniqueViolationIn,
  pgErrorOf as pgErrorOfIn,
  type PgErrorShape,
} from '@cbrl/pg'
import * as Cause from 'effect/Cause'

const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

export const USERS_MOBILE_UNIQUE = 'users_mobile_unique'

function unwrapFiberFailure(value: object): unknown {
  const parked: unknown = Reflect.get(value, FIBER_FAILURE_CAUSE)
  return Cause.isCause(parked) ? Cause.squash(parked) : undefined
}

const options = { unwrap: unwrapFiberFailure }

export function pgErrorOf(err: unknown): PgErrorShape {
  return pgErrorOfIn(err, options)
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return isUniqueViolationIn(err, constraint, options)
}

export function isForeignKeyViolation(err: unknown): boolean {
  return isForeignKeyViolationIn(err, undefined, options)
}
