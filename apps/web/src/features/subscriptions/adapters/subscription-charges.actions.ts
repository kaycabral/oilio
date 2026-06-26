'use server'

import { Charge, Subscription, computeBillingPeriod } from '@/domain'
import {
  nextChargeAfterFailure,
  nextSubscriptionStatusAfterFailure,
} from '@/features/subscriptions/core/charge-failure'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { SubscriptionConfig } from '@/domain/aggregates'
import { dispatchNotificationReactions } from '@/features/notifications/adapters/reactor-dispatch'
import {
  buildMarkFailedSteps,
  buildMarkPaidSteps,
  buildRenewSteps,
} from '@/features/subscriptions/adapters/subscription-charges-saga'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { type ChargeRow, rowToDoc as chargeRowToDoc } from '@/shared/db/pg/effect/charge-projector'
import {
  type SubscriptionRow,
  rowToDoc as subscriptionRowToDoc,
} from '@/shared/db/pg/effect/subscription-projector'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { newId } from '@/shared/db/pg/new-id'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { commitSaga, emitEvent } from '@/shared/effect-bridge'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { Schema } from 'effect'

import type { ChargeMutationResult } from '@/features/subscriptions/core/subscription-results'

const decodeCharge = Schema.decodeUnknownSync(Charge)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

// Single charge by id, read from the typed projection under RLS.
async function getChargeById(orgId: string, chargeId: string): Promise<Charge | null> {
  const rows = await readUnderRls<ChargeRow>(orgId, (client) =>
    client
      .query<ChargeRow>('SELECT * FROM charges WHERE aggregate_path = $1', [
        `orgs/${orgId}/charges/${chargeId}`,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeCharge(chargeRowToDoc(row)) : null
}

// Single subscription by id, read from the typed projection under RLS.
async function getSubscriptionById(orgId: string, id: string): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>('SELECT * FROM subscriptions WHERE aggregate_path = $1', [
        `orgs/${orgId}/subscriptions/${id}`,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscription(subscriptionRowToDoc(row)) : null
}

export async function markChargePaid(chargeId: string): Promise<ChargeMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const charge = await getChargeById(orgId, chargeId)
  if (!charge) return { ok: false, error: 'Cobrança não encontrada' }
  if (charge.status === 'paid') return { ok: false, error: 'Cobrança já marcada como paga' }
  if (charge.status === 'refunded' || charge.status === 'cancelled') {
    return { ok: false, error: 'Cobrança não pode ser marcada como paga (estornada/cancelada)' }
  }

  const sub = await getSubscriptionById(orgId, charge.subscriptionId)
  if (!sub) return { ok: false, error: 'Assinatura vinculada não encontrada' }

  const actorId = r.ctx.session.uid
  const now = new Date().toISOString()

  // The cascade: `charge.succeeded` then (unless cancelled) `subscription
  // .charge_settled` — settling reactivates the subscription, preserving period +
  // consumption. Two aggregates → ONE ACID transaction.
  const outcome = await commitSaga(
    buildMarkPaidSteps({
      orgId,
      actorId,
      chargeId,
      subscriptionId: charge.subscriptionId,
      attempts: charge.attempts,
      now,
      settle: sub.status !== 'cancelled',
    }),
  )
  if (!outcome.ok) return { ok: false, error: outcome.error }
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

  const orgId = r.ctx.membership.orgId
  const charge = await getChargeById(orgId, chargeId)
  if (!charge) return { ok: false, error: 'Cobrança não encontrada' }
  if (charge.status === 'paid') return { ok: false, error: 'Cobrança já liquidada' }
  if (charge.status === 'refunded' || charge.status === 'cancelled') {
    return { ok: false, error: 'Cobrança não pode ser marcada como falha' }
  }

  const sub = await getSubscriptionById(orgId, charge.subscriptionId)
  if (!sub) return { ok: false, error: 'Assinatura vinculada não encontrada' }

  const actorId = r.ctx.session.uid
  const subscriptionId = charge.subscriptionId
  const now = new Date().toISOString()
  const nextCharge = nextChargeAfterFailure(charge.attempts)
  const subStatus = nextSubscriptionStatusAfterFailure(sub.status, charge.attempts)
  const failureReason = reason?.trim() || null

  // The cascade: `charge.failed` then `subscription.charge_failed` (the action
  // decides the next sub status; the reducer projects it). Two aggregates → ONE
  // ACID transaction. The notification dispatch is a side-effect that runs AFTER
  // the cascade lands.
  async function dispatchFailureNotification(): Promise<void> {
    await dispatchNotificationReactions('subscription.charge_failed', actorId, {
      reason: failureReason ?? 'manual_mark',
      orgId,
      subscriptionId,
    })
  }

  const outcome = await commitSaga(
    buildMarkFailedSteps({
      orgId,
      actorId,
      chargeId,
      subscriptionId,
      now,
      nextChargeStatus: nextCharge.status,
      nextChargeAttempts: nextCharge.attempts,
      subStatus,
      failureReason,
    }),
  )
  if (!outcome.ok) return { ok: false, error: outcome.error }
  await dispatchFailureNotification()
  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
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

  const orgId = r.ctx.membership.orgId
  const sub = await getSubscriptionById(orgId, subscriptionId)
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (sub.status === 'cancelled') return { ok: false, error: 'Assinatura cancelada não renova' }

  const now = new Date().toISOString()

  // cancelAtPeriodEnd=true: encerra de vez ao invés de renovar. O evento
  // `cancelled` projeta status='cancelled' + cancelledAt + nextChargeDate=null.
  if (sub.cancelAtPeriodEnd) {
    const cancelled = await emitEvent(
      SubscriptionConfig,
      `orgs/${r.ctx.membership.orgId}/subscriptions/${subscriptionId}`,
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
  const chargeId = newId()

  const charge: Charge = {
    id: chargeId,
    orgId,
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

  const actorId = r.ctx.session.uid

  // The cascade: the next cycle's `charge.created` then the subscription's
  // `renewed` (new period; resets consumption; keeps status). Two aggregates →
  // ONE ACID transaction. The activation notification runs after the cascade
  // lands.
  async function dispatchRenewalNotification(): Promise<void> {
    await dispatchNotificationReactions('subscription.activated', actorId, {
      orgId,
      subscriptionId,
    })
  }

  const outcome = await commitSaga(
    buildRenewSteps({
      orgId,
      actorId,
      subscriptionId,
      charge,
      periodStart: nextPeriod.startAt,
      periodEnd: nextPeriod.endAt,
      nextChargeDate: nextPeriod.endAt,
    }),
  )
  if (!outcome.ok) return { ok: false, error: outcome.error }
  await dispatchRenewalNotification()
  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
  return { ok: true }
}

export async function deleteSubscription(subscriptionId: string): Promise<ChargeMutationResult> {
  // Hard-delete só por owner — perda de histórico financeiro é risco.
  // Cancelamento (acima) é o caminho padrão.
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId

  // Event-first: emite `deleted` (o appendEvent preserva o stream e NÃO
  // reprojeta — convenção `.deleted`) e só então remove o read model.
  const deleted = await emitEvent(
    SubscriptionConfig,
    `orgs/${orgId}/subscriptions/${subscriptionId}`,
    {
      _tag: 'subscription.deleted',
      actorId: r.ctx.session.uid,
      payload: { deletedBy: r.ctx.session.uid },
    },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  // A cross-aggregate `ON DELETE RESTRICT` FK (brief 0068 D2 — charges referencing
  // this subscription) is the DB's last-line guard: convert its 23503 into a
  // friendly result instead of a raw 500.
  try {
    await deleteOrgProjectionDoc(orgId, 'subscriptions', subscriptionId)
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: 'Não é possível excluir esta assinatura: há cobranças vinculadas a ela.',
      }
    }
    throw err
  }

  revalidatePath('/subscriptions')
  redirect('/subscriptions')
}
