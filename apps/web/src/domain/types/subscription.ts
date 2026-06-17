import { Schema } from 'effect'

import { AllowedTimeScope, BillingCycle, BookingLimits, UsageLimit } from './subscription-plan'

// Estados de assinatura:
// - pending: criada, aguardando primeira cobrança ser liquidada.
// - active: ciclo atual pago, cliente pode consumir benefícios.
// - past_due: última cobrança falhou; sistema vai retentar antes de suspender.
//   (terminologia de billing — alinhada com Pagar.me/Stripe). Anteriormente
//   chamado `recovering` no V0 V0.1.0.
// - suspended: falhas persistentes; cliente perde acesso até regularizar.
// - cancelled: cancelada voluntariamente (por cliente ou owner). Não renova.
// - cancelled_for_non_payment: cancelada automaticamente após N ciclos em
//   past_due. Distinto de `cancelled` voluntário pra rastreio + métrica.
export const SUBSCRIPTION_STATUSES = [
  'pending',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'cancelled_for_non_payment',
] as const
export const SubscriptionStatus = Schema.Literal(...SUBSCRIPTION_STATUSES)
export type SubscriptionStatus = typeof SubscriptionStatus.Type

// Snapshot do plano no momento que a assinatura foi criada. Plano pode mudar
// preço / limite depois — assinatura ativa congela as condições contratadas.
export const SubscriptionPlanSnapshot = Schema.mutable(
  Schema.Struct({
    planId: Schema.String,
    name: Schema.String,
    priceCents: Schema.Number,
    billingCycle: BillingCycle,
    // Frozen FK array into `CatalogItem.id` (brief 0024, AC-01). Snapshot of the
    // plan's `includedItemIds` at subscription creation — plan edits never
    // retroact on the snapshot. Slice 2 (#1009) resolves consumption against
    // this frozen coverage.
    includedItemIds: Schema.mutable(Schema.Array(Schema.String)),
    // Frozen FK array into `Category.id` (brief 0023, AC-04). Snapshot of the
    // plan's `includedCategoryIds` at subscription creation — plan edits never
    // retroact on the snapshot. Convenience coverage alongside `includedItemIds`
    // (brief 0024, AC-02).
    includedCategoryIds: Schema.mutable(Schema.Array(Schema.String)),
    usageLimit: UsageLimit,
    // Frozen copy of `SubscriptionPlan.unitAllowlist` (brief 0019, Group A).
    // `undefined` = no restriction. Plan-level edits never retroact on the
    // snapshot — owner must cancel and re-create the subscription to apply
    // a new scope rule to an existing customer.
    unitAllowlist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    // Frozen copy of `SubscriptionPlan.allowedTimeScope` (brief 0019,
    // Group B). Same snapshot semantics as `unitAllowlist`.
    allowedTimeScope: Schema.optional(AllowedTimeScope),
    // Frozen copy of `SubscriptionPlan.bookingLimits` (brief 0019,
    // Group C). Same snapshot semantics — plan-level edits never retroact.
    bookingLimits: Schema.optional(BookingLimits),
  }),
)
export type SubscriptionPlanSnapshot = typeof SubscriptionPlanSnapshot.Type

// Janela vigente de consumo. `consumed` cresce a cada order fechada com
// `paymentMethod: 'subscription'`. Reset acontece quando renewSubscription
// abre um novo período (cria o próximo Charge e zera o consumo).
export const SubscriptionPeriod = Schema.mutable(
  Schema.Struct({
    startAt: Schema.String,
    endAt: Schema.String,
    consumed: Schema.Number,
  }),
)
export type SubscriptionPeriod = typeof SubscriptionPeriod.Type

export const Subscription = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    // Unidade dona da assinatura (contexto de unidade único — brief 0043).
    // Capturado da unidade ativa na criação e imutável durante a vigência;
    // MRR/ARR/assinantes filtram por ele. Espelha `Order.unitId`. Multi-unidade
    // por assinatura fica fora (futuro).
    unitId: Schema.String,
    customerId: Schema.String,
    // Denormalizado do Customer.userId pra permitir cross-tenant query
    // via collectionGroup quando customer acessa /me/subscriptions (#651).
    // Pattern espelha Appointment.customerUserId — User é a única bridge
    // de identidade do customer (não tem membership). null em legacy data.
    customerUserId: Schema.NullOr(Schema.String),
    // Snapshot completo do plano no momento da criação (preço/limite imutáveis
    // durante a vigência do ciclo). Renovação reavalia o plano vigente.
    plan: SubscriptionPlanSnapshot,
    status: SubscriptionStatus,
    // Período corrente — começa no startAt e roda até endAt; em renewSubscription
    // o sistema arquiva o anterior e abre um novo. Fonte de verdade pro saldo.
    currentPeriod: SubscriptionPeriod,
    // Quando setado, a assinatura não renova ao fim do período corrente —
    // ela vira `cancelled` automaticamente em renewSubscription.
    cancelAtPeriodEnd: Schema.Boolean,
    // Data prevista da próxima cobrança automática. Coincide com
    // currentPeriod.endAt + 1 dia (renovação dispara na virada).
    nextChargeDate: Schema.NullOr(Schema.String),
    // Contador de ciclos consecutivos em past_due (brief 0003 AC-09).
    // Incrementa em cada `transaction.refused`; zera quando volta pra active.
    // Quando alcança `pastDueThreshold`, próxima falha vira
    // `cancelled_for_non_payment`. Default 0.
    pastDueCycles: Schema.Number,
    // Threshold configurável por subscription (snapshot do plan/tenant). Default 2.
    pastDueThreshold: Schema.Number,
    // Razão do cancelamento (texto curto opcional do owner ou cliente).
    cancellationReason: Schema.NullOr(Schema.String),
    cancelledAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
).pipe(
  // `cancelledAt` existe SSE a assinatura está cancelada — fecha o drift de
  // "ativa com cancelledAt" e "cancelada sem data" (refinamento no decode).
  Schema.filter(
    (s) => {
      const cancelled = s.status === 'cancelled' || s.status === 'cancelled_for_non_payment'
      return cancelled ? s.cancelledAt !== null : s.cancelledAt === null
    },
    { message: () => 'cancelledAt deve existir sse status é cancelado' },
  ),
)
export type Subscription = typeof Subscription.Type
