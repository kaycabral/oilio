import { describe, expect, it } from 'vitest'
import {
  CHARGE_FAILURE_THRESHOLD,
  nextChargeAfterFailure,
  nextSubscriptionStatusAfterFailure,
} from './charge-failure'

describe('nextChargeAfterFailure (#650)', () => {
  it('first failure → recovering with attempts=1', () => {
    expect(nextChargeAfterFailure(0)).toEqual({ status: 'recovering', attempts: 1 })
  })

  it('second failure → recovering with attempts=2', () => {
    expect(nextChargeAfterFailure(1)).toEqual({ status: 'recovering', attempts: 2 })
  })

  it('third failure → failed with attempts=3 (threshold reached)', () => {
    expect(nextChargeAfterFailure(2)).toEqual({ status: 'failed', attempts: 3 })
  })

  it('beyond threshold keeps the charge failed', () => {
    expect(nextChargeAfterFailure(3)).toEqual({ status: 'failed', attempts: 4 })
  })

  it('threshold constant matches the V0 policy', () => {
    expect(CHARGE_FAILURE_THRESHOLD).toBe(3)
  })
})

describe('nextSubscriptionStatusAfterFailure (#650)', () => {
  it('active → recovering on first failure', () => {
    expect(nextSubscriptionStatusAfterFailure('active', 0)).toBe('past_due')
  })

  it('active → recovering on second failure', () => {
    expect(nextSubscriptionStatusAfterFailure('active', 1)).toBe('past_due')
  })

  it('recovering → cancelled_for_non_payment on third failure (threshold)', () => {
    expect(nextSubscriptionStatusAfterFailure('past_due', 2)).toBe('cancelled_for_non_payment')
  })

  it('already-cancelled subscriptions stay cancelled regardless of attempts', () => {
    expect(nextSubscriptionStatusAfterFailure('cancelled', 0)).toBe('cancelled')
    expect(nextSubscriptionStatusAfterFailure('cancelled', 5)).toBe('cancelled')
  })

  it('a subscription cancelled for non-payment stays terminal (no resurrection)', () => {
    expect(nextSubscriptionStatusAfterFailure('cancelled_for_non_payment', 3)).toBe(
      'cancelled_for_non_payment',
    )
  })
})
