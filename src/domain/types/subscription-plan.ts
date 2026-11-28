import { Schema, Struct } from 'effect'

import { NonNegativeInt } from '@/domain/value-objects'

export const BillingCycle = Schema.Literals(['monthly', 'quarterly', 'semiannual', 'annual'])
export type BillingCycle = typeof BillingCycle.Type

export const BILLING_CYCLES: readonly BillingCycle[] = [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
]

export const UsageLimit = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unlimited') }).mapFields(Struct.map(Schema.mutableKey)),
  Schema.Struct({ kind: Schema.Literal('count'), quantity: Schema.Number }).mapFields(
    Struct.map(Schema.mutableKey),
  ),
])
export type UsageLimit = typeof UsageLimit.Type

export const AllowedTimeScope = Schema.Struct({
  daysOfWeek: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))),
  hourRange: Schema.optional(
    Schema.Struct({ start: Schema.String, end: Schema.String }).mapFields(
      Struct.map(Schema.mutableKey),
    ),
  ),
  advanceBookingDays: Schema.optional(Schema.Number),
}).mapFields(Struct.map(Schema.mutableKey))
export type AllowedTimeScope = typeof AllowedTimeScope.Type

export const BookingLimits = Schema.Struct({
  maxPerDay: Schema.optional(Schema.Number),
  maxConcurrent: Schema.optional(Schema.Number),
  requireCompleteBeforeNext: Schema.optional(Schema.Boolean),
}).mapFields(Struct.map(Schema.mutableKey))
export type BookingLimits = typeof BookingLimits.Type

export const SubscriptionPlan = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  priceCents: NonNegativeInt,
  billingCycle: BillingCycle,
  includedItemIds: Schema.mutable(Schema.Array(Schema.String)),
  includedCategoryIds: Schema.mutable(Schema.Array(Schema.String)),
  usageLimit: UsageLimit,
  unitAllowlist: Schema.optional(Schema.NullOr(Schema.mutable(Schema.Array(Schema.String)))),
  allowedTimeScope: Schema.optional(Schema.NullOr(AllowedTimeScope)),
  bookingLimits: Schema.optional(Schema.NullOr(BookingLimits)),
  active: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type SubscriptionPlan = typeof SubscriptionPlan.Type
