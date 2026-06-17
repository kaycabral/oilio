import type { SubscriptionStatus } from '@/domain'

// Política V0 de inadimplência (#650). Mantida pura e fora do server action
// pra ficar testável sem emulator e pra ser o único lugar canônico onde a
// regra "≥3 tentativas → suspended" vive.
//
// Quando o gateway real (pagar.me) plugar, esta política troca: o gateway
// vai entregar attempts + signals próprios (e.g. card_declined vs gateway_error)
// e a transição pode ficar mais granular. Por agora é o stub V0.

export const CHARGE_FAILURE_THRESHOLD = 3 as const

export type ChargeAfterFailure = {
  status: 'past_due' | 'failed'
  attempts: number
}

export function nextChargeAfterFailure(currentAttempts: number): ChargeAfterFailure {
  const attempts = currentAttempts + 1
  return {
    status: attempts >= CHARGE_FAILURE_THRESHOLD ? 'failed' : 'past_due',
    attempts,
  }
}

export function nextSubscriptionStatusAfterFailure(
  currentStatus: SubscriptionStatus,
  currentAttempts: number,
): SubscriptionStatus {
  // Subscriptions já canceladas não voltam — falha continua marcada na charge
  // mas o status da subscription preserva o estado terminal.
  if (currentStatus === 'cancelled') return 'cancelled'
  const attempts = currentAttempts + 1
  if (attempts >= CHARGE_FAILURE_THRESHOLD) return 'suspended'
  return 'past_due'
}
