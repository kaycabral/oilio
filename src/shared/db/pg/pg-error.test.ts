import * as Cause from 'effect/Cause'
import { describe, expect, it } from 'vitest'
import { isForeignKeyViolation, isUniqueViolation, USERS_MOBILE_UNIQUE } from './pg-error'

const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

describe('isForeignKeyViolation', () => {
  it('a bare pg DatabaseError with code 23503 is a violation', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
  })

  it('a pg error with a different SQLSTATE is NOT a violation', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false)
  })

  it('non-object / nullish inputs are not violations', () => {
    expect(isForeignKeyViolation(null)).toBe(false)
    expect(isForeignKeyViolation(undefined)).toBe(false)
    expect(isForeignKeyViolation('23503')).toBe(false)
    expect(isForeignKeyViolation(23503)).toBe(false)
  })

  it('an error with no code is not a violation', () => {
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false)
  })

  it('follows the bare `.cause` chain to find a nested violation', () => {
    const nested = { message: 'wrapper', cause: { code: '23503' } }
    expect(isForeignKeyViolation(nested)).toBe(true)
  })

  it('a `.cause` chain with no violation returns false', () => {
    const nested = { message: 'a', cause: { message: 'b', cause: { code: '08006' } } }
    expect(isForeignKeyViolation(nested)).toBe(false)
  })

  it('unwraps a FiberFailure-parked Cause and re-checks the squashed defect', () => {
    const parked = { [FIBER_FAILURE_CAUSE]: Cause.die({ code: '23503' }) }
    expect(isForeignKeyViolation(parked)).toBe(true)
  })

  it('a FiberFailure parking a non-FK defect is not a violation', () => {
    const parked = { [FIBER_FAILURE_CAUSE]: Cause.die({ code: '23505' }) }
    expect(isForeignKeyViolation(parked)).toBe(false)
  })

  it('terminates on a self-referential cause cycle (no infinite loop)', () => {
    const cyclic: { code?: string; cause?: unknown } = { code: 'XXXXX' }
    cyclic.cause = cyclic
    expect(isForeignKeyViolation(cyclic)).toBe(false)
  })
})

describe('isUniqueViolation', () => {
  it('matches a unique violation on the named constraint, even parked in a FiberFailure', () => {
    const pgError = { code: '23505', constraint: USERS_MOBILE_UNIQUE }
    expect(isUniqueViolation(pgError, USERS_MOBILE_UNIQUE)).toBe(true)
    expect(
      isUniqueViolation({ [FIBER_FAILURE_CAUSE]: Cause.die(pgError) }, USERS_MOBILE_UNIQUE),
    ).toBe(true)
  })

  it('rejects another constraint or SQLSTATE', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'other' }, USERS_MOBILE_UNIQUE)).toBe(
      false,
    )
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
  })
})
