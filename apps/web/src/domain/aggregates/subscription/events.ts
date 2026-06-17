import { Schema } from 'effect'

const StatusSchema = Schema.Literal(
  'pending',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'cancelled_for_non_payment',
)

const UsageLimitSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('unlimited') }),
  Schema.Struct({ kind: Schema.Literal('count'), quantity: Schema.Number }),
)

const PlanSnapshotSchema = Schema.Struct({
  planId: Schema.String,
  name: Schema.String,
  priceCents: Schema.Number,
  billingCycle: Schema.Literal('monthly', 'quarterly', 'semiannual', 'annual'),
  includedItemIds: Schema.mutable(Schema.Array(Schema.String)),
  includedCategoryIds: Schema.mutable(Schema.Array(Schema.String)),
  usageLimit: UsageLimitSchema,
  unitAllowlist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  allowedTimeScope: Schema.optional(
    Schema.Struct({
      daysOfWeek: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))),
      hourRange: Schema.optional(Schema.Struct({ start: Schema.String, end: Schema.String })),
      advanceBookingDays: Schema.optional(Schema.Number),
    }),
  ),
  bookingLimits: Schema.optional(
    Schema.Struct({
      maxPerDay: Schema.optional(Schema.Number),
      maxConcurrent: Schema.optional(Schema.Number),
      requireCompleteBeforeNext: Schema.optional(Schema.Boolean),
    }),
  ),
})

export const SubscriptionCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.created'),
  id: Schema.String,
  tenantId: Schema.String,
  unitId: Schema.String,
  customerId: Schema.String,
  customerUserId: Schema.NullOr(Schema.String),
  planId: Schema.String,
  plan: PlanSnapshotSchema,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  nextChargeDate: Schema.NullOr(Schema.String),
  pastDueThreshold: Schema.Number,
})

export const SubscriptionChargeSettledSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.charge_settled'),
})

export const ChargeFailedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.charge_failed'),
  reason: Schema.String,
  status: Schema.optional(StatusSchema),
})

export const SubscriptionCancelledForNonPaymentSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.cancelled_for_non_payment'),
  failedChargeCount: Schema.Number,
})

export const SubscriptionCancelledSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.cancelled'),
  cancelledBy: Schema.String,
})

export const SubscriptionCancelScheduledSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.cancel_scheduled'),
  cancelledBy: Schema.String,
  cancellationReason: Schema.NullOr(Schema.String),
})

export const SubscriptionReactivatedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.reactivated'),
})

export const SubscriptionRenewedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.renewed'),
  periodStart: Schema.String,
  periodEnd: Schema.String,
  nextChargeDate: Schema.NullOr(Schema.String),
})

export const SubscriptionPlanChangedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.plan_changed'),
  planId: Schema.String,
  plan: PlanSnapshotSchema,
  changedBy: Schema.String,
})

export const SubscriptionUsageIncrementedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.usage_incremented'),
  amount: Schema.Number,
})

export const SubscriptionDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription.deleted'),
  deletedBy: Schema.String,
})

export const SubscriptionEventSchema = Schema.Union(
  SubscriptionCreatedSchema,
  SubscriptionChargeSettledSchema,
  ChargeFailedSchema,
  SubscriptionCancelledForNonPaymentSchema,
  SubscriptionCancelledSchema,
  SubscriptionCancelScheduledSchema,
  SubscriptionReactivatedSchema,
  SubscriptionRenewedSchema,
  SubscriptionPlanChangedSchema,
  SubscriptionUsageIncrementedSchema,
  SubscriptionDeletedSchema,
)

export type SubscriptionCreated = typeof SubscriptionCreatedSchema.Type
export type SubscriptionChargeSettled = typeof SubscriptionChargeSettledSchema.Type
export type SubscriptionChargeFailed = typeof ChargeFailedSchema.Type
export type SubscriptionCancelledForNonPayment =
  typeof SubscriptionCancelledForNonPaymentSchema.Type
export type SubscriptionCancelled = typeof SubscriptionCancelledSchema.Type
export type SubscriptionCancelScheduled = typeof SubscriptionCancelScheduledSchema.Type
export type SubscriptionReactivated = typeof SubscriptionReactivatedSchema.Type
export type SubscriptionRenewed = typeof SubscriptionRenewedSchema.Type
export type SubscriptionPlanChanged = typeof SubscriptionPlanChangedSchema.Type
export type SubscriptionUsageIncremented = typeof SubscriptionUsageIncrementedSchema.Type
export type SubscriptionDeleted = typeof SubscriptionDeletedSchema.Type
export type SubscriptionEvent = typeof SubscriptionEventSchema.Type
