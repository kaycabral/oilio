'use server'

import {
  CUSTOMER_CANCEL_REASON_MESSAGES,
  Subscription,
  canCustomerCancelSubscription,
} from '@/domain'
import { SubscriptionConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'

export type SelfCancelResult = { ok: true } | { ok: false; error: string }

// #651 — Customer self-cancel pela página `/me/subscriptions`.
//
// Authorization: cliente só cancela Subscription onde
// `customerUserId === session.uid`. Cross-org access enforced via User
// (sem membership) — pattern espelha #845 (cancelOwnAppointment).
//
// Behavior (AC-12 do brief 0003): cancelamento mid-cycle marca
// `cancelAtPeriodEnd: true` — Subscription continua usável até fim do
// currentPeriod. Renewal hook detecta cancelAtPeriodEnd no fim e vira
// `cancelled` (lá em renewSubscription action existente).
//
// Audit: `subscription.cancel` com `metadata.via: 'self_cancel'` pra
// distinguir de owner-cancel (managers cancelam via /(app)/subscriptions).
export async function cancelOwnSubscription(input: {
  orgId: string
  subscriptionId: string
}): Promise<SelfCancelResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada — entre de novo.' }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(input.orgId)
  const subRef = orgRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(input.subscriptionId)
  const subSnap = await subRef.get()
  const subscription = subSnap.data()
  if (!subscription) return { ok: false, error: 'Assinatura não encontrada.' }

  const decision = canCustomerCancelSubscription(subscription, session.uid)
  if (!decision.canCancel) {
    return { ok: false, error: CUSTOMER_CANCEL_REASON_MESSAGES[decision.reason] }
  }

  // Event-first: a projeção (`cancelAtPeriodEnd`/`cancellationReason`) vem do
  // `subscription.cancel_scheduled`, não de um `subRef.update()` paralelo. A
  // auditoria "quem cancelou, quando" é o próprio stream — sem `audit_logs`
  // (erradicação ES, #1029).
  const scheduled = await emitEvent(
    SubscriptionConfig,
    `orgs/${input.orgId}/subscriptions/${input.subscriptionId}`,
    {
      _tag: 'subscription.cancel_scheduled',
      actorId: session.uid,
      payload: { cancelledBy: session.uid, cancellationReason: 'self_cancel' },
    },
  )
  if (!scheduled.ok) return { ok: false, error: scheduled.error }

  return { ok: true }
}
