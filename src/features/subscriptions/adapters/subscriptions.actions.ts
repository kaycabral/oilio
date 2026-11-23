'use server'

import { revalidatePath } from 'next/cache'

import {
  buildPlanSnapshot,
  type Charge,
  computeBillingPeriod,
  lawfulPriceCents as computeLawfulPrice,
  DEFAULT_UNIT_TIMEZONE,
  Subscription,
  SubscriptionPlan,
} from '@/domain'

import { ChargeConfig, SubscriptionConfig, SubscriptionPlanConfig } from '@/domain/aggregates'
import { aggregateRef, type GuardReader } from '@/domain/effect'
import {
  type SubscriptionRow,
  rowToDoc as subscriptionRowToDoc,
} from '@/shared/db/pg/effect/subscription-projector'
import { newId } from '@/shared/db/pg/new-id'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { commitGuardedThenAppend, emitEvent } from '@/shared/effect-bridge'
import { Effect, Schema } from 'effect'

import { buildMarkPaidSteps } from '@/features/subscriptions/adapters/subscription-charges-saga'
import {
  parseCreateForm,
  resolveVigenciaStart,
} from '@/features/subscriptions/core/subscription-form'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getCustomerUserId } from '@/shared/org/customer-read'
import { requireManagerCtx, requireRecurringManagerCtx } from '@/shared/org/membership'
import { getSubscriptionPlanById } from '@/shared/org/subscription-plan-read'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

async function getSubscriptionById(orgId: string, id: string): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>('SELECT * FROM subscriptions WHERE org_id = $1 AND id = $2', [
        orgId,
        id,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscription(subscriptionRowToDoc(row)) : null
}

import type {
  ChargeMutationResult,
  SubscriptionMutationResult,
} from '@/features/subscriptions/core/subscription-results'
export type {
  ChargeMutationResult,
  SubscriptionMutationResult,
} from '@/features/subscriptions/core/subscription-results'

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const

async function customerHasActiveSubscription(orgId: string, customerId: string): Promise<boolean> {
  const rows = await readUnderRls<{ exists: boolean }>(orgId, (client) =>
    client
      .query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM subscriptions
           WHERE org_id = $1 AND customer_id = $2 AND status = ANY($3)
         ) AS exists`,
        [orgId, customerId, ACTIVE_SUBSCRIPTION_STATUSES],
      )
      .then((res) => res.rows),
  )
  return rows[0]?.exists ?? false
}

export async function createSubscription(formData: FormData): Promise<SubscriptionMutationResult> {
  const r = await requireRecurringManagerCtx()
  if (!r.ok) return r
  const parsed = parseCreateForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const { units, activeUnitId } = await resolveActiveUnit(r.ctx.membership)
  if (!activeUnitId) {
    return { ok: false, error: 'Nenhuma unidade ativa — crie uma unidade antes de assinar' }
  }
  const unitTimezone = units.find((u) => u.id === activeUnitId)?.timezone ?? DEFAULT_UNIT_TIMEZONE

  const orgId = r.ctx.membership.orgId

  const [customerUserId, plan] = await Promise.all([
    getCustomerUserId(orgId, parsed.customerId),
    getSubscriptionPlanById(orgId, parsed.planId),
  ])
  if (!customerUserId) return { ok: false, error: 'Cliente não encontrado' }
  if (!plan) return { ok: false, error: 'Plano não encontrado' }

  if (!plan.active) return { ok: false, error: 'Plano está inativo' }
  if (plan.archivedAt) {
    return { ok: false, error: 'Plano foi descontinuado e não aceita novas adesões' }
  }

  if (await customerHasActiveSubscription(orgId, parsed.customerId)) {
    return { ok: false, error: 'Cliente já possui assinatura ativa — cancele antes de criar nova' }
  }

  const startAt = resolveVigenciaStart(parsed.startDate, unitTimezone)
  const period = computeBillingPeriod(startAt, parsed.billingCycle)
  const now = new Date().toISOString()

  const subId = newId()
  const chargeId = newId()
  const planRef = aggregateRef(SubscriptionPlanConfig, orgId, parsed.planId)

  const subRef = aggregateRef(SubscriptionConfig, orgId, subId)
  const chargeRef = aggregateRef(ChargeConfig, orgId, chargeId)

  const guardedSub = {
    config: SubscriptionConfig,
    ref: subRef,
    actorId: r.ctx.session.uid,
    tag: 'subscription.created' as const,
    guard: (reader: GuardReader) =>
      Effect.gen(function* () {
        const livePlan = yield* reader.getDoc(planRef, SubscriptionPlan)
        if (!livePlan) {
          return { _tag: 'reject' as const, message: 'Plano não encontrado' }
        }
        if (!livePlan.active || livePlan.archivedAt) {
          return { _tag: 'reject' as const, message: 'Plano descontinuado' }
        }
        const lawful = computeLawfulPrice(parsed.displayedPriceCents, livePlan.priceCents)
        const planSnapshot = buildPlanSnapshot(livePlan, {
          billingCycle: parsed.billingCycle,
          priceCents: lawful,
        })
        return {
          _tag: 'ok' as const,
          payload: {
            id: subId,
            orgId,
            unitId: activeUnitId,
            customerId: parsed.customerId,
            customerUserId,
            planId: livePlan.id,
            plan: planSnapshot,
            periodStart: period.startAt,
            periodEnd: period.endAt,
            nextChargeDate: period.endAt,
            pastDueThreshold: 2,
          },
        }
      }),
  }

  const buildCharge = (amountCents: number): Charge => ({
    id: chargeId,
    orgId,
    unitId: activeUnitId,
    subscriptionId: subId,
    customerId: parsed.customerId,
    amountCents,
    periodStartAt: period.startAt,
    periodEndAt: period.endAt,
    dueDate: period.startAt,
    status: 'scheduled',
    attempts: 0,
    paidAt: null,
    failedAt: null,
    failureReason: null,
    refundedAt: null,
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  })
  const lawfulFrom = (payload: Record<string, unknown>): number => {
    const planSnap = payload['plan']
    if (planSnap && typeof planSnap === 'object' && 'priceCents' in planSnap) {
      const price = planSnap.priceCents
      if (typeof price === 'number') return price
    }
    throw new Error('subscription.created payload missing a numeric plan.priceCents (lawful price)')
  }

  const outcome = await commitGuardedThenAppend(guardedSub, {
    config: ChargeConfig,
    ref: chargeRef,
    buildEvent: (payload) => ({
      _tag: 'charge.created',
      actorId: r.ctx.session.uid,
      payload: { data: buildCharge(lawfulFrom(payload)) },
    }),
    buildExtraSteps: (payload) =>
      buildMarkPaidSteps({
        orgId,
        actorId: r.ctx.session.uid,
        chargeId,
        subscriptionId: subId,
        attempts: 0,
        now,
        periodStartAt: period.startAt,
        amountCents: lawfulFrom(payload),
        unitId: activeUnitId,
        settle: true,
      }),
  })
  if (!outcome.ok) return { ok: false, error: outcome.error }
  revalidatePath('/subscriptions')
  return { ok: true, subscriptionId: subId }
}

export async function cancelSubscription(
  subscriptionId: string,
  reason: string | null,
): Promise<ChargeMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const sub = await getSubscriptionById(orgId, subscriptionId)
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (sub.status === 'cancelled') return { ok: false, error: 'Assinatura já cancelada' }

  const scheduled = await emitEvent(
    SubscriptionConfig,
    aggregateRef(SubscriptionConfig, orgId, subscriptionId),
    {
      _tag: 'subscription.cancel_scheduled',
      actorId: r.ctx.session.uid,
      payload: {
        cancelledBy: r.ctx.session.uid,
        cancellationReason: reason?.trim() || null,
      },
    },
  )
  if (!scheduled.ok) return { ok: false, error: scheduled.error }

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
  return { ok: true }
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
): Promise<ChargeMutationResult> {
  const r = await requireRecurringManagerCtx()
  if (!r.ok) return r

  const trimmedPlanId = newPlanId.trim()
  if (!trimmedPlanId) return { ok: false, error: 'Plano de destino é obrigatório' }

  const orgId = r.ctx.membership.orgId
  const [sub, plan] = await Promise.all([
    getSubscriptionById(orgId, subscriptionId),
    getSubscriptionPlanById(orgId, trimmedPlanId),
  ])
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (sub.status === 'cancelled') {
    return { ok: false, error: 'Assinatura cancelada — não é possível trocar de plano' }
  }
  if (sub.plan.planId === trimmedPlanId) {
    return { ok: false, error: 'Assinatura já está nesse plano' }
  }
  if (!plan) return { ok: false, error: 'Plano de destino não encontrado' }
  if (!plan.active) return { ok: false, error: 'Plano de destino está inativo' }

  const planSnapshot = buildPlanSnapshot(plan, { billingCycle: sub.plan.billingCycle })

  const changed = await emitEvent(
    SubscriptionConfig,
    aggregateRef(SubscriptionConfig, orgId, subscriptionId),
    {
      _tag: 'subscription.plan_changed',
      actorId: r.ctx.session.uid,
      payload: { planId: plan.id, plan: planSnapshot, changedBy: r.ctx.session.uid },
    },
  )
  if (!changed.ok) return { ok: false, error: changed.error }

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
  return { ok: true }
}

export async function reactivateSubscription(
  subscriptionId: string,
): Promise<ChargeMutationResult> {
  const r = await requireRecurringManagerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const sub = await getSubscriptionById(orgId, subscriptionId)
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (!sub.cancelAtPeriodEnd)
    return { ok: false, error: 'Assinatura não está marcada para cancelar' }
  if (sub.status === 'cancelled') return { ok: false, error: 'Assinatura já encerrada' }

  const reactivated = await emitEvent(
    SubscriptionConfig,
    aggregateRef(SubscriptionConfig, orgId, subscriptionId),
    { _tag: 'subscription.reactivated', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!reactivated.ok) return { ok: false, error: reactivated.error }

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
  return { ok: true }
}
