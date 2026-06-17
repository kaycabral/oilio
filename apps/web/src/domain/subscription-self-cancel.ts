// Pure helper que decide se cliente pode cancelar sua Subscription via
// `/me/subscriptions`. AC-11/12 do brief 0003 (sub-issue #651).
//
// Pattern espelha `canCustomerCancelAppointment` em #845.
// Pure function (no I/O) pra mesma lógica rodar no SSR (decisão de habilitar
// botão UI) e no server action (autorização de write).

import type { Subscription, SubscriptionStatus } from './types/subscription'

export type CustomerCancelReason =
  | 'already_cancelled'
  | 'not_active'
  | 'wrong_owner'
  | 'cancel_at_period_end_already_set'

export type CustomerCancelResult =
  | { canCancel: true }
  | { canCancel: false; reason: CustomerCancelReason }

/**
 * Verifica se um User (via uid) pode cancelar uma Subscription self-service.
 *
 * Regras (v0.2.0 mínimas, sem janela de antecedência):
 * - Subscription tem que pertencer ao User (customerUserId === uid)
 * - Status precisa permitir cancelamento (pending, active, past_due, suspended)
 * - cancelAtPeriodEnd NÃO pode já estar marcado
 *
 * Janela de antecedência (minNoticeMinutes) NÃO é aplicada nesta versão.
 * Owner pode adicionar via tenant config futura — capturar atrito se
 * Aurora #X confirmar necessidade.
 */
export function canCustomerCancelSubscription(
  subscription: Subscription,
  uid: string,
): CustomerCancelResult {
  if (subscription.customerUserId !== uid) {
    return { canCancel: false, reason: 'wrong_owner' }
  }

  const cancellable: SubscriptionStatus[] = ['pending', 'active', 'past_due', 'suspended']
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
