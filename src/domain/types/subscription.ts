import { Schema } from 'effect'

import { NonEmptyString, NonNegativeInt } from '@/domain/value-objects'
import { AllowedTimeScope, BillingCycle, BookingLimits, UsageLimit } from './subscription-plan'

export const SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'cancelled',
  'cancelled_for_non_payment',
] as const
export const SubscriptionStatus = Schema.Literal(...SUBSCRIPTION_STATUSES)
export type SubscriptionStatus = typeof SubscriptionStatus.Type

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Ativa',
  past_due: 'Em recuperação',
  cancelled: 'Cancelada',
  cancelled_for_non_payment: 'Cancelada por inadimplência',
}

export const SubscriptionPlanSnapshot = Schema.mutable(
  Schema.Struct({
    planId: NonEmptyString,
    name: NonEmptyString,
    priceCents: NonNegativeInt,
    billingCycle: BillingCycle,
    includedItemIds: Schema.mutable(Schema.Array(Schema.String)),
    includedCategoryIds: Schema.mutable(Schema.Array(Schema.String)),
    usageLimit: UsageLimit,
    unitAllowlist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    allowedTimeScope: Schema.optional(AllowedTimeScope),
    bookingLimits: Schema.optional(BookingLimits),
  }),
)
export type SubscriptionPlanSnapshot = typeof SubscriptionPlanSnapshot.Type

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
    orgId: Schema.String,
    unitId: Schema.String,
    customerId: Schema.String,
    customerUserId: Schema.NullOr(NonEmptyString),
    plan: SubscriptionPlanSnapshot,
    status: SubscriptionStatus,
    currentPeriod: SubscriptionPeriod,
    cancelAtPeriodEnd: Schema.Boolean,
    nextChargeDate: Schema.NullOr(Schema.String),
    pastDueCycles: NonNegativeInt,
    pastDueThreshold: NonNegativeInt,
    cancellationReason: Schema.NullOr(Schema.String),
    cancelledAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
).pipe(
  Schema.filter(
    (s) => {
      const cancelled = s.status === 'cancelled' || s.status === 'cancelled_for_non_payment'
      return cancelled ? s.cancelledAt !== null : s.cancelledAt === null
    },
    { message: () => 'cancelledAt deve existir sse status é cancelado' },
  ),
)
export type Subscription = typeof Subscription.Type
