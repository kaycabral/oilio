'use server'

import { revalidatePath } from 'next/cache'

import {
  type Charge,
  Subscription,
  SubscriptionPlan,
  buildPlanSnapshot,
  computeBillingPeriod,
  lawfulPriceCents as computeLawfulPrice,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'

import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent, emitEventGuarded } from '@/shared/effect-bridge'
import { Effect, Schema } from 'effect'

import { parseCreateForm } from '@/features/subscriptions/core/subscription-form'
import { resolveActiveUnit } from '@/shared/tenant/active-unit'
import { requireManagerCtx } from '@/shared/tenant/membership'

import type {
  ChargeMutationResult,
  SubscriptionMutationResult,
} from '@/features/subscriptions/core/subscription-results'
export type {
  ChargeMutationResult,
  SubscriptionMutationResult,
} from '@/features/subscriptions/core/subscription-results'

// Minimal projection of the customer shadow — only `userId` is read here to
// stamp the subscription's `customerUserId`; identity PII lives on the User doc.
const CustomerUserIdProjection = Schema.Struct({ userId: Schema.String })

export async function createSubscription(formData: FormData): Promise<SubscriptionMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseCreateForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Contexto de unidade único (brief 0043): a assinatura nasce na unidade
  // ativa do contexto. Sem unidade não há onde ancorar o MRR — espelha
  // `createOrder`.
  const { activeUnitId } = await resolveActiveUnit(r.ctx.membership)
  if (!activeUnitId) {
    return { ok: false, error: 'Nenhuma unidade ativa — crie uma unidade antes de assinar' }
  }

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)

  const [customerSnap, planSnap] = await Promise.all([
    tenantRef
      .collection('customers')
      .withConverter(fsConverter(CustomerUserIdProjection))
      .doc(parsed.customerId)
      .get(),
    tenantRef
      .collection('subscription_plans')
      .withConverter(fsConverter(SubscriptionPlan))
      .doc(parsed.planId)
      .get(),
  ])
  const customerData = customerSnap.data()
  if (!customerData) return { ok: false, error: 'Cliente não encontrado' }
  const plan = planSnap.data()
  if (!plan) return { ok: false, error: 'Plano não encontrado' }

  const customerUserId = customerData.userId

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
  const existing = await tenantRef
    .collection('subscriptions')
    .where('customerId', '==', parsed.customerId)
    .where('status', 'in', ['pending', 'active', 'past_due', 'suspended'])
    .limit(1)
    .get()
  if (!existing.empty) {
    return { ok: false, error: 'Cliente já possui assinatura ativa — cancele antes de criar nova' }
  }

  const period = computeBillingPeriod(parsed.startAt, parsed.billingCycle)
  const now = new Date().toISOString()

  const subRef = tenantRef.collection('subscriptions').doc()
  const chargeRef = tenantRef.collection('charges').doc()
  const planPath = `tenants/${r.ctx.membership.tenantId}/subscription_plans/${parsed.planId}`

  // Guard transacional de descontinuação + preço (brief 0033 AC-08/AC-09): o
  // read do plano (ativo + preço) acontece DENTRO da transação que appenda
  // `subscription.created`, travando o doc do plano. Concorrência otimista do
  // Firestore fecha a corrida "descontinua/reprecifica em T / assina em T+δ":
  // descontinuado no commit → rejeita; preço snapshotado = min(exibido, vigente).
  // Leitura de definição pra guardar/snapshotar o WRITE de UM aggregate (a
  // assinatura) — não é saga cross-aggregate. O preço apurado é capturado pra a
  // cobrança herdar o MESMO valor legal do snapshot.
  let lawfulPriceCents = plan.priceCents
  const created = await emitEventGuarded({
    config: SubscriptionConfig,
    aggregatePath: `tenants/${r.ctx.membership.tenantId}/subscriptions/${subRef.id}`,
    actorId: r.ctx.session.uid,
    tag: 'subscription.created',
    guard: (reader) =>
      Effect.gen(function* () {
        const livePlan = yield* reader.getDoc(planPath, SubscriptionPlan)
        if (!livePlan) {
          return { _tag: 'reject' as const, message: 'Plano não encontrado' }
        }
        if (!livePlan.active || livePlan.archivedAt) {
          return { _tag: 'reject' as const, message: 'Plano descontinuado' }
        }
        // AC-09 — preço na divergência segue a lei (CDC art. 30 + Decreto
        // 5.903/2006 art. 5º): cobra o MENOR entre o exibido e o vigente.
        lawfulPriceCents = computeLawfulPrice(parsed.displayedPriceCents, livePlan.priceCents)
        const planSnapshot = buildPlanSnapshot(livePlan, {
          billingCycle: parsed.billingCycle,
          priceCents: lawfulPriceCents,
        })
        return {
          _tag: 'ok' as const,
          payload: {
            id: subRef.id,
            tenantId: r.ctx.membership.tenantId,
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
  })
  if (!created.ok) return { ok: false, error: created.error }

  // Event-first: a cobrança nasce de `charge.created` (snapshot completo) — a
  // projeção escreve o doc, sem `set` paralelo. Herda o preço LEGAL apurado no
  // guard (min(exibido, vigente)), nunca o `plan.priceCents` do pre-flight.
  const charge: Charge = {
    id: chargeRef.id,
    tenantId: r.ctx.membership.tenantId,
    unitId: activeUnitId,
    subscriptionId: subRef.id,
    customerId: parsed.customerId,
    amountCents: lawfulPriceCents,
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
  }
  const chargeCreated = await emitEvent(
    ChargeConfig,
    `tenants/${r.ctx.membership.tenantId}/charges/${chargeRef.id}`,
    { _tag: 'charge.created', actorId: r.ctx.session.uid, payload: { data: charge } },
  )
  if (!chargeCreated.ok) return { ok: false, error: chargeCreated.error }

  revalidatePath('/subscriptions')
  return { ok: true, subscriptionId: subRef.id }
}

export async function cancelSubscription(
  subscriptionId: string,
  reason: string | null,
): Promise<ChargeMutationResult> {
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
  if (sub.status === 'cancelled') return { ok: false, error: 'Assinatura já cancelada' }

  // Cancelamento SUAVE (ao fim do ciclo) — espelha o self-cancel do cliente
  // (`me/subscriptions/actions.ts`, AC-12 do brief 0003). O evento
  // `cancel_scheduled` só marca `cancelAtPeriodEnd`; status segue ativo e o
  // benefício vale até o fim do período. O corte efetivo (status='cancelled'
  // via `subscription.cancelled`) acontece em `renewSubscription` no vencimento.
  // Auditoria vem do stream — sem `recordAudit` paralelo (AC-07).
  const scheduled = await emitEvent(
    SubscriptionConfig,
    `tenants/${r.ctx.membership.tenantId}/subscriptions/${subscriptionId}`,
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

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)
  const subRef = tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(subscriptionId)

  const [subSnap, planSnap] = await Promise.all([
    subRef.get(),
    tenantRef
      .collection('subscription_plans')
      .withConverter(fsConverter(SubscriptionPlan))
      .doc(trimmedPlanId)
      .get(),
  ])
  const sub = subSnap.data()
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (sub.status === 'cancelled') {
    return { ok: false, error: 'Assinatura cancelada — não é possível trocar de plano' }
  }
  if (sub.plan.planId === trimmedPlanId) {
    return { ok: false, error: 'Assinatura já está nesse plano' }
  }
  const plan = planSnap.data()
  if (!plan) return { ok: false, error: 'Plano de destino não encontrado' }
  if (!plan.active) return { ok: false, error: 'Plano de destino está inativo' }

  // Preserva o ciclo de cobrança contratado — a troca é de escopo/preço do
  // plano, não do cadência de cobrança vigente.
  const planSnapshot = buildPlanSnapshot(plan, { billingCycle: sub.plan.billingCycle })

  const changed = await emitEvent(
    SubscriptionConfig,
    `tenants/${r.ctx.membership.tenantId}/subscriptions/${subscriptionId}`,
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

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(r.ctx.membership.tenantId)
  const subRef = tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .doc(subscriptionId)
  const snap = await subRef.get()
  const sub = snap.data()
  if (!sub) return { ok: false, error: 'Assinatura não encontrada' }
  if (!sub.cancelAtPeriodEnd)
    return { ok: false, error: 'Assinatura não está marcada para cancelar' }
  if (sub.status === 'cancelled') return { ok: false, error: 'Assinatura já encerrada' }

  const reactivated = await emitEvent(
    SubscriptionConfig,
    `tenants/${r.ctx.membership.tenantId}/subscriptions/${subscriptionId}`,
    { _tag: 'subscription.reactivated', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!reactivated.ok) return { ok: false, error: reactivated.error }

  revalidatePath('/subscriptions')
  revalidatePath(`/subscriptions/${subscriptionId}`)
  return { ok: true }
}
