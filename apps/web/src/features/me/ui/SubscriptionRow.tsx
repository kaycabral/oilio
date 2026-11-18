'use client'

import type { CustomerCancelReason, Subscription } from '@/domain'
import { CUSTOMER_CANCEL_REASON_MESSAGES, SUBSCRIPTION_STATUS_LABEL } from '@/domain'
import { cancelOwnSubscription } from '@/features/me/adapters/subscriptions.actions'
import { Button } from '@oilio/design'
import { useState, useTransition } from 'react'

export type SubscriptionRowData = {
  subscription: Subscription
  orgName: string
  canCancel: boolean
  cantCancelReason: CustomerCancelReason | null
}

export function SubscriptionRow({ data }: { data: SubscriptionRowData }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const { subscription, orgName, canCancel, cantCancelReason } = data

  if (cancelled) {
    return (
      <div className="rounded-lg border p-4 text-sm">
        <p className="font-medium">
          {orgName} — {subscription.plan.name}
        </p>
        <p className="text-muted-foreground" role="status">
          Cancelamento solicitado. A assinatura encerra ao fim do ciclo atual.
        </p>
      </div>
    )
  }

  function handleCancel() {
    setError(null)
    startTransition(async () => {
      const result = await cancelOwnSubscription({
        orgId: subscription.orgId,
        subscriptionId: subscription.id,
      })
      if (!result.ok) setError(result.error)
      else setCancelled(true)
    })
  }

  const cantReason = cantCancelReason ? CUSTOMER_CANCEL_REASON_MESSAGES[cantCancelReason] : null

  return (
    <div className="rounded-lg border p-4">
      <p className="font-medium">{orgName}</p>
      <p className="text-muted-foreground text-sm">{subscription.plan.name}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Status: {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
        {subscription.cancelAtPeriodEnd ? ' · cancela ao fim do ciclo' : ''}
      </p>
      <div className="mt-3 flex items-center gap-3">
        {canCancel ? (
          <Button variant="destructive" onClick={handleCancel} disabled={pending}>
            {pending ? 'Cancelando…' : 'Cancelar assinatura'}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">{cantReason}</span>
        )}
      </div>
      {error ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
