import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { isForeignKeyViolation, isUniqueViolation, USERS_MOBILE_UNIQUE } from './pg-error'

function rejectionOf(defect: unknown): Promise<unknown> {
  return Effect.runPromise(Effect.die(defect)).then(
    () => undefined,
    (err: unknown) => err,
  )
}

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

  it('classifies the defect an Effect run rejects with (no runtime wrapper)', async () => {
    expect(isForeignKeyViolation(await rejectionOf({ code: '23503' }))).toBe(true)
  })

  it('a non-FK defect rejected by an Effect run is not a violation', async () => {
    expect(isForeignKeyViolation(await rejectionOf({ code: '23505' }))).toBe(false)
  })

  it('terminates on a self-referential cause cycle (no infinite loop)', () => {
    const cyclic: { code?: string; cause?: unknown } = { code: 'XXXXX' }
    cyclic.cause = cyclic
    expect(isForeignKeyViolation(cyclic)).toBe(false)
  })
})

describe('isUniqueViolation', () => {
  it('matches a unique violation on the named constraint, even rejected by an Effect run', async () => {
    const pgError = { code: '23505', constraint: USERS_MOBILE_UNIQUE }
    expect(isUniqueViolation(pgError, USERS_MOBILE_UNIQUE)).toBe(true)
    expect(isUniqueViolation(await rejectionOf(pgError), USERS_MOBILE_UNIQUE)).toBe(true)
  })

  it('rejects another constraint or SQLSTATE', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'other' }, USERS_MOBILE_UNIQUE)).toBe(
      false,
    )
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
  })
})
