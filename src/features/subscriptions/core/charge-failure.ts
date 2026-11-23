import type { SubscriptionStatus } from '@/domain'

export const CHARGE_FAILURE_THRESHOLD = 3 as const

export type ChargeAfterFailure = {
  status: 'recovering' | 'failed'
  attempts: number
}

export function nextChargeAfterFailure(currentAttempts: number): ChargeAfterFailure {
  const attempts = currentAttempts + 1
  return {
    status: attempts >= CHARGE_FAILURE_THRESHOLD ? 'failed' : 'recovering',
    attempts,
  }
}

export function nextSubscriptionStatusAfterFailure(
  currentStatus: SubscriptionStatus,
  currentAttempts: number,
): SubscriptionStatus {
  if (currentStatus === 'cancelled' || currentStatus === 'cancelled_for_non_payment') {
    return currentStatus
  }
  const attempts = currentAttempts + 1
  if (attempts >= CHARGE_FAILURE_THRESHOLD) return 'cancelled_for_non_payment'
  return 'past_due'
}
