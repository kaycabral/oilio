import type { Subscription, SubscriptionStatus } from './types/subscription'

export type CustomerCancelReason =
  'already_cancelled' | 'not_active' | 'wrong_owner' | 'cancel_at_period_end_already_set'

export type CustomerCancelResult =
  { canCancel: true } | { canCancel: false; reason: CustomerCancelReason }

export function canCustomerCancelSubscription(
  subscription: Subscription,
  uid: string,
): CustomerCancelResult {
  if (subscription.customerUserId !== uid) {
    return { canCancel: false, reason: 'wrong_owner' }
  }

  const cancellable: SubscriptionStatus[] = ['active', 'past_due']
  if (!cancellable.includes(subscription.status)) {
    return { canCancel: false, reason: 'already_cancelled' }
  }

  if (subscription.cancelAtPeriodEnd) {
    return { canCancel: false, reason: 'cancel_at_period_end_already_set' }
  }

  return { canCancel: true }
}

export const CUSTOMER_CANCEL_REASON_MESSAGES: Record<CustomerCancelReason, string> = {
  wrong_owner: 'Esta assinatura pertence a outra conta.',
  already_cancelled: 'Esta assinatura já foi cancelada ou encerrada.',
  not_active: 'Esta assinatura ainda não está ativa.',
  cancel_at_period_end_already_set:
    'Cancelamento já foi solicitado. A assinatura encerra ao fim do ciclo atual.',
}
