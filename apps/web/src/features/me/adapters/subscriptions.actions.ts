'use server'

import {
  CUSTOMER_CANCEL_REASON_MESSAGES,
  Subscription,
  canCustomerCancelSubscription,
} from '@/domain'
import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { Schema } from 'effect'

export type SelfCancelResult = { ok: true } | { ok: false; error: string }

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

async function loadSubscriptionById(
  orgId: string,
  subscriptionId: string,
): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>('SELECT * FROM subscriptions WHERE org_id = $1 AND id = $2', [
        orgId,
        subscriptionId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscription(subscriptionRowToDoc(row)) : null
}

export async function cancelOwnSubscription(input: {
  orgId: string
  subscriptionId: string
}): Promise<SelfCancelResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada — entre de novo.' }

  const subscription = await loadSubscriptionById(input.orgId, input.subscriptionId)
  if (!subscription) return { ok: false, error: 'Assinatura não encontrada.' }

  const decision = canCustomerCancelSubscription(subscription, session.uid)
  if (!decision.canCancel) {
    return { ok: false, error: CUSTOMER_CANCEL_REASON_MESSAGES[decision.reason] }
  }

  const scheduled = await emitEvent(
    SubscriptionConfig,
    aggregateRef(SubscriptionConfig, input.orgId, input.subscriptionId),
    {
      _tag: 'subscription.cancel_scheduled',
      actorId: session.uid,
      payload: { cancelledBy: session.uid, cancellationReason: 'self_cancel' },
    },
  )
  if (!scheduled.ok) return { ok: false, error: scheduled.error }

  return { ok: true }
}
