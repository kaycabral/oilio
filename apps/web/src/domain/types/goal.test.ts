import { describe, expect, it } from 'vitest'
import { GOAL_TARGET_MIN_CENTS, goalDocId, isValidGoalPeriod } from './goal'

describe('goalDocId', () => {
  it('is deterministic per (type, unit, period)', () => {
    expect(goalDocId('profit', 'unit-a', '2026-06')).toBe('profit__unit-a__2026-06')
    expect(goalDocId('profit', 'unit-a', '2026-06')).toBe(goalDocId('profit', 'unit-a', '2026-06'))
  })

  it('distinguishes unit and period', () => {
    expect(goalDocId('profit', 'unit-a', '2026-06')).not.toBe(
      goalDocId('profit', 'unit-b', '2026-06'),
    )
    expect(goalDocId('profit', 'unit-a', '2026-06')).not.toBe(
      goalDocId('profit', 'unit-a', '2026-07'),
    )
  })
})

describe('isValidGoalPeriod', () => {
  it.each(['2026-01', '2026-12', '1999-06'])('accepts valid YYYY-MM (%s)', (p) => {
    expect(isValidGoalPeriod(p)).toBe(true)
  })

  it.each(['2026-00', '2026-13', '2026-6', '26-06', '2026/06', '', 'nope'])(
    'rejects malformed period (%s)',
    (p) => {
      expect(isValidGoalPeriod(p)).toBe(false)
    },
  )
})

describe('GOAL_TARGET_MIN_CENTS', () => {
  it('requires a positive target', () => {
    expect(GOAL_TARGET_MIN_CENTS).toBe(1)
  })
})
