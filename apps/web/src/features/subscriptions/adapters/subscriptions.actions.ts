'use server'

import { revalidatePath } from 'next/cache'

import {
  buildPlanSnapshot,
  type Charge,
  computeBillingPeriod,
  lawfulPriceCents as computeLawfulPrice,
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

import { hasCapability } from '@/domain/billing/capabilities'
import { parseCreateForm } from '@/features/subscriptions/core/subscription-form'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getOrgTier } from '@/shared/org/billing-read'
import { getCustomerUserId } from '@/shared/org/customer-read'
import { requireManagerCtx } from '@/shared/org/membership'
import { getSubscriptionPlanById } from '@/shared/org/subscription-plan-read'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

// Single subscription by id, read from the typed projection under RLS.
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

const ACTIVE_SUBSCRIPTION_STATUSES = ['pending', 'active', 'past_due', 'suspended'] as const

// Whether the customer already has a non-terminal subscription in this org (V0
// assumes 1 plan per customer). Existence check under RLS — no decode.
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
  const r = await requireManagerCtx()
  if (!r.ok) return r
  // Plano Oilio gate (brief 0072/0082): a subscription CONSUMES the recurring
  // capability just as creating the plan does — so the tier wall belongs here
  // too, not only on `createPlan`. A Pro→Free downgrade leaves the plan rows in
  // place; without this an org off the Pro tier could still adopt a plan via a
  // stale form / direct call. Server-side is the real boundary; the UI CTA is
  // defense-in-depth (brief 0082).
  const tier = await getOrgTier(r.ctx.membership.orgId)
  if (!hasCapability(tier, 'plans.recurring')) {
    return {
      ok: false,
      error: 'Assinaturas estão disponíveis no plano Pro. Faça upgrade para assinar planos.',
    }
  }
  const parsed = parseCreateForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Contexto de unidade único (brief 0043): a assinatura nasce na unidade
  // ativa do contexto. Sem unidade não há onde ancorar o MRR — espelha
  // `createOrder`.
  const { activeUnitId } = await resolveActiveUnit(r.ctx.membership)
  if (!activeUnitId) {
    return { ok: false, error: 'Nenhuma unidade ativa — crie uma unidade antes de assinar' }
  }

  const orgId = r.ctx.membership.orgId

  const [customerUserId, plan] = await Promise.all([
    getCustomerUserId(orgId, parsed.customerId),
    getSubscriptionPlanById(orgId, parsed.planId),
  ])
  if (!customerUserId) return { ok: false, error: 'Cliente não encontrado' }
  if (!plan) return { ok: false, error: 'Plano não encontrado' }

  // Pre-flight (UX): falha cedo se o plano já está inativo/descontinuado ao
  // abrir. A verdade que fecha a corrida vem do read transacional no guard
  // abaixo — esta checagem é só pra mensagem rápida no caminho feliz.
  if (!plan.active) return { ok: false, error: 'Plano está inativo' }
  // A discontinued (soft-deleted) plan must NOT back a NEW subscription — the
  // active subscribers finish their cycle on their frozen snapshot, but novas
  // adesões ficam bloqueadas (brief 0033, bug 1 + AC-08 use-time guard). The
  // `/subscriptions/new` picker already filters archived plans; this is the
  // server-side defense so a stale form / direct call can't slip through.
  if (plan.archivedAt) {
    return { ok: false, error: 'Plano foi descontinuado e não aceita novas adesões' }
  }

  // Bloqueia segunda assinatura ativa pro mesmo cliente — modelo V0 assume
  // 1 plano por cliente. Owner pode cancelar e criar nova se precisar trocar.
  if (await customerHasActiveSubscription(orgId, parsed.customerId)) {
    return { ok: false, error: 'Cliente já possui assinatura ativa — cancele antes de criar nova' }
  }

  const period = computeBillingPeriod(parsed.startAt, parsed.billingCycle)
  const now = new Date().toISOString()

  const subId = newId()
  const chargeId = newId()
  const planRef = aggregateRef(SubscriptionPlanConfig, orgId, parsed.planId)

  // Guard transacional de descontinuação + preço (brief 0033 AC-08/AC-09): o
  // read do plano (ativo + preço) acontece DENTRO da transação que appenda
  // `subscription.created`, travando o doc do plano. Descontinuado no commit →
  // rejeita; preço snapshotado = min(exibido, vigente). Leitura de definição pra
  // guardar/snapshotar o WRITE de UM aggregate (a assinatura). O preço apurado é
  // capturado pra a cobrança herdar o MESMO valor legal do snapshot.
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
        // AC-09 — preço na divergência segue a lei (CDC art. 30 + Decreto
        // 5.903/2006 art. 5º): cobra o MENOR entre o exibido e o vigente.
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

  // The charge inherits the LAWFUL price resolved in the guard — read it off the
  // resolved subscription payload's plan snapshot, so the charge can never carry
  // a price the subscription didn't. Event-first: a cobrança nasce de
  // `charge.created` (snapshot completo).
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
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  })
  // The charge MUST inherit the lawful price the guard computed and baked into the
  // snapshot (min(displayed, current) — AC-09 / CDC art. 30). If the resolved
  // payload doesn't carry it (a future snapshot-shape change), FAIL rather than
  // fall back to the pre-flight `plan.priceCents` — that pre-tx value is exactly
  // what AC-09 forbids, and a silent fallback would overcharge invisibly.
  const lawfulFrom = (payload: Record<string, unknown>): number => {
    const planSnap = payload['plan']
    if (planSnap && typeof planSnap === 'object' && 'priceCents' in planSnap) {
      const price = planSnap.priceCents
      if (typeof price === 'number') return price
    }
    throw new Error('subscription.created payload missing a numeric plan.priceCents (lawful price)')
  }

  // Subscription + charge as ONE ACID transaction — the subscription is never
  // orphaned of its charge on the failure path (brief 0061 § Grupo B / AC-02).
  // The guard resolves the price in-tx; the charge inherits it.
  const outcome = await commitGuardedThenAppend(guardedSub, ChargeConfig, chargeRef, (payload) => ({
    _tag: 'charge.created',
    actorId: r.ctx.session.uid,
    payload: { data: buildCharge(lawfulFrom(payload)) },
  }))
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

  // Cancelamento SUAVE (ao fim do ciclo) — espelha o self-cancel do cliente
  // (`me/subscriptions/actions.ts`, AC-12 do brief 0003). O evento
  // `cancel_scheduled` só marca `cancelAtPeriodEnd`; status segue ativo e o
  // benefício vale até o fim do período. O corte efetivo (status='cancelled'
  // via `subscription.cancelled`) acontece em `renewSubscription` no vencimento.
  // Auditoria vem do stream — sem `recordAudit` paralelo (AC-07).
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

/**
 * Troca explícita de plano de um assinante (ADR 0010, D5 / AC-07). NÃO é
 * efeito colateral de editar o plano — editar o plano nunca retroage no
 * snapshot congelado (`buildPlanSnapshot` no create). Esta action é o único
 * caminho para mover um assinante para outro plano: captura um snapshot fresco
 * do plano de destino e emite `subscription.plan_changed`. Não retroativo —
 * vale do change-point em diante; a renovação herda o novo snapshot.
 *
 * Guardas: owner/manager; assinatura existe e não cancelada; plano de destino
 * existe + ativo; plano de destino difere do contratado (idempotente).
 */
export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
): Promise<ChargeMutationResult> {
  const r = await requireManagerCtx()
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

  // Preserva o ciclo de cobrança contratado — a troca é de escopo/preço do
  // plano, não do cadência de cobrança vigente.
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
  const r = await requireManagerCtx()
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
