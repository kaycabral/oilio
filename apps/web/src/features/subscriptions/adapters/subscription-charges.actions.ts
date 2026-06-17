'use server'

import { Charge, Subscription, computeBillingPeriod } from '@/domain'
import {
  nextChargeAfterFailure,
  nextSubscriptionStatusAfterFailure,
} from '@/features/subscriptions/core/charge-failure'
import { getAdminFirestore } from '@/shared/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { dispatchNotificationReactions } from '@/features/notifications/adapters/reactor-dispatch'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/tenant/membership'

import type { ChargeMutationResult } from '@/features/subscriptions/core/subscription-results'

export async function markChargePaid(chargeId: string): Promise<ChargeMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)
  const chargeRef = tenantRef.collection('charges').withConverter(fsConverter(Charge)).doc(chargeId)
  const snap = await chargeRef.get()
  const charge = snap.data()
  if (!charge) return { ok: false, error: 'Cobrança não encontrada' }
  if (charge.status === 'paid') return { ok: false, error: 'Cobrança já marcada como paga' }
  if (charge.status === 'refunded' || charge.status === 'cancelled') {
    return { ok: false, error: 'Cobrança não pode ser marcada como paga (estornada/cancelada)' }
  }

  const subRef = tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(charge.subscriptionId)
  const subSnap = await subRef.get()
  const sub = subSnap.data()
  if (!sub) return { ok: false, error: 'Assinatura vinculada não encontrada' }

  const now = new Date().toISOString()
  // Event-first: a liquidação manual emite `charge.succeeded` (sem `.update`).
  const paid = await emitEvent(
    ChargeConfig,
    `tenants/${r.ctx.membership.tenantId}/charges/${chargeId}`,
    {
      _tag: 'charge.succeeded',
      actorId: r.ctx.session.uid,
      payload: {
        changes: {
          status: 'paid',
          paidAt: now,
          failedAt: null,
          failureReason: null,
          attempts: charge.attempts + 1,
          lastActorUid: r.ctx.session.uid,
          updatedAt: now,
        },
      },
    },
  )
  if (!paid.ok) return { ok: false, error: paid.error }

  // Liquidar a cobrança reativa a assinatura (status='active') via evento —
  // preserva período e consumo. Cancelled fica intacto. (Charge segue write
  // direto: aggregate próprio, fatia de conformidade à parte.)
  if (sub.status !== 'cancelled') {
    const settled = await emitEvent(
      SubscriptionConfig,
      `tenants/${r.ctx.membership.tenantId}/subscriptions/${charge.subscriptionId}`,
      { _tag: 'subscription.charge_settled', actorId: r.ctx.session.uid, payload: {} },
    )
    if (!settled.ok) return { ok: false, error: settled.error }
  }

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${charge.subscriptionId}`)
  return { ok: true }
}

export async function markChargeFailed(
  chargeId: string,
  reason: string | null,
): Promise<ChargeMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)
  const chargeRef = tenantRef.collection('charges').withConverter(fsConverter(Charge)).doc(chargeId)
  const snap = await chargeRef.get()
  const charge = snap.data()
  if (!charge) return { ok: false, error: 'Cobrança não encontrada' }
  if (charge.status === 'paid') return { ok: false, error: 'Cobrança já liquidada' }
  if (charge.status === 'refunded' || charge.status === 'cancelled') {
    return { ok: false, error: 'Cobrança não pode ser marcada como falha' }
  }

  const subRef = tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(charge.subscriptionId)
  const subSnap = await subRef.get()
  const sub = subSnap.data()
  if (!sub) return { ok: false, error: 'Assinatura vinculada não encontrada' }

  const now = new Date().toISOString()
  const nextCharge = nextChargeAfterFailure(charge.attempts)
  const subStatus = nextSubscriptionStatusAfterFailure(sub.status, charge.attempts)

  // Event-first: a falha manual emite `charge.failed` (status recovering/failed
  // no changes — sem `.update` paralelo).
  const chargeFailed = await emitEvent(
    ChargeConfig,
    `tenants/${r.ctx.membership.tenantId}/charges/${chargeId}`,
    {
      _tag: 'charge.failed',
      actorId: r.ctx.session.uid,
      payload: {
        changes: {
          status: nextCharge.status,
          failedAt: now,
          failureReason: reason?.trim() || null,
          attempts: nextCharge.attempts,
          lastActorUid: r.ctx.session.uid,
          updatedAt: now,
        },
      },
    },
  )
  if (!chargeFailed.ok) return { ok: false, error: chargeFailed.error }

  // Status da assinatura vem do evento: a action decide via
  // `nextSubscriptionStatusAfterFailure` e o reducer projeta (sem write direto).
  const failed = await emitEvent(
    SubscriptionConfig,
    `tenants/${r.ctx.membership.tenantId}/subscriptions/${charge.subscriptionId}`,
    {
      _tag: 'subscription.charge_failed',
      actorId: r.ctx.session.uid,
      payload: { reason: reason?.trim() || 'manual_mark', status: subStatus },
    },
  )
  if (!failed.ok) return { ok: false, error: failed.error }

  await dispatchNotificationReactions('subscription.charge_failed', r.ctx.session.uid, {
    reason: reason?.trim() || 'manual_mark',
    tenantId: r.ctx.membership.tenantId,
    subscriptionId: charge.subscriptionId,
  })

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${charge.subscriptionId}`)
  return { ok: true }
}

/**
 * Renova manualmente — fecha período atual e abre o próximo, criando
 * novo charge `scheduled`. Em produção, isso é disparado por cron quando
 * `Date.now() >= currentPeriod.endAt`. V0 expõe botão na UI p/ owner
 * exercitar o fluxo sem precisar esperar o ciclo virar.
 */
export async function renewSubscription(subscriptionId: string): Promise<ChargeMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)
  const subRef = tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(subscriptionId)
  const snap = await subRef.get()
  const sub = snap.data()
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (sub.status === 'cancelled') return { ok: false, error: 'Assinatura cancelada não renova' }

  const now = new Date().toISOString()

  // cancelAtPeriodEnd=true: encerra de vez ao invés de renovar. O evento
  // `cancelled` projeta status='cancelled' + cancelledAt + nextChargeDate=null.
  if (sub.cancelAtPeriodEnd) {
    const cancelled = await emitEvent(
      SubscriptionConfig,
      `tenants/${r.ctx.membership.tenantId}/subscriptions/${subscriptionId}`,
      {
        _tag: 'subscription.cancelled',
        actorId: r.ctx.session.uid,
        payload: { cancelledBy: r.ctx.session.uid },
      },
    )
    if (!cancelled.ok) return { ok: false, error: cancelled.error }
    revalidatePath('/subscriptions')
    revalidatePath(`/subscriptions/${subscriptionId}`)
    return { ok: true }
  }

  const nextPeriod = computeBillingPeriod(sub.currentPeriod.endAt, sub.plan.billingCycle)
  const chargeRef = tenantRef.collection('charges').doc()

  const charge: Charge = {
    id: chargeRef.id,
    tenantId: r.ctx.membership.tenantId,
    // Herda a unidade da assinatura (brief 0043) — o ciclo seguinte cobra na
    // mesma unidade que originou a recorrência.
    unitId: sub.unitId,
    subscriptionId,
    customerId: sub.customerId,
    amountCents: sub.plan.priceCents,
    periodStartAt: nextPeriod.startAt,
    periodEndAt: nextPeriod.endAt,
    dueDate: nextPeriod.startAt,
    status: 'scheduled',
    attempts: 0,
    paidAt: null,
    failedAt: null,
    failureReason: null,
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  }

  // Event-first: a cobrança do próximo ciclo nasce de `charge.created`. O
  // período novo da assinatura vem do evento `renewed` (zera consumo; mantém
  // status).
  const chargeCreated = await emitEvent(
    ChargeConfig,
    `tenants/${r.ctx.membership.tenantId}/charges/${chargeRef.id}`,
    { _tag: 'charge.created', actorId: r.ctx.session.uid, payload: { data: charge } },
  )
  if (!chargeCreated.ok) return { ok: false, error: chargeCreated.error }

  const renewed = await emitEvent(
    SubscriptionConfig,
    `tenants/${r.ctx.membership.tenantId}/subscriptions/${subscriptionId}`,
    {
      _tag: 'subscription.renewed',
      actorId: r.ctx.session.uid,
      payload: {
        periodStart: nextPeriod.startAt,
        periodEnd: nextPeriod.endAt,
        nextChargeDate: nextPeriod.endAt,
      },
    },
  )
  if (!renewed.ok) return { ok: false, error: renewed.error }
  await dispatchNotificationReactions('subscription.activated', r.ctx.session.uid, {
    tenantId: r.ctx.membership.tenantId,
    subscriptionId,
  })

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
  return { ok: true }
}

export async function deleteSubscription(subscriptionId: string): Promise<ChargeMutationResult> {
  // Hard-delete só por owner — perda de histórico financeiro é risco.
  // Cancelamento (acima) é o caminho padrão.
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)

  // Event-first: emite `deleted` (o appendEvent preserva o stream e NÃO
  // reprojeta — convenção `.deleted`) e só então remove o read model.
  const deleted = await emitEvent(
    SubscriptionConfig,
    `tenants/${r.ctx.membership.tenantId}/subscriptions/${subscriptionId}`,
    {
      _tag: 'subscription.deleted',
      actorId: r.ctx.session.uid,
      payload: { deletedBy: r.ctx.session.uid },
    },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await tenantRef.collection('subscriptions').doc(subscriptionId).delete()

  revalidatePath('/subscriptions')
  redirect('/subscriptions')
}
