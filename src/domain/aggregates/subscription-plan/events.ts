import { SubscriptionPlan } from '@/domain/types/subscription-plan'
import { Schema, Struct } from 'effect'

export const SubscriptionPlanCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription_plan.created'),
  data: SubscriptionPlan,
})

export const SubscriptionPlanUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription_plan.updated'),
  changes: SubscriptionPlan.mapFields(Struct.map(Schema.optional)),
})

export const SubscriptionPlanDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription_plan.deleted'),
})

export const SubscriptionPlanArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('subscription_plan.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const SubscriptionPlanEventSchema = Schema.Union([
  SubscriptionPlanCreatedSchema,
  SubscriptionPlanUpdatedSchema,
  SubscriptionPlanDeletedSchema,
  SubscriptionPlanArchivedSchema,
])

export type SubscriptionPlanCreated = typeof SubscriptionPlanCreatedSchema.Type
export type SubscriptionPlanUpdated = typeof SubscriptionPlanUpdatedSchema.Type
export type SubscriptionPlanDeleted = typeof SubscriptionPlanDeletedSchema.Type
export type SubscriptionPlanArchived = typeof SubscriptionPlanArchivedSchema.Type
export type SubscriptionPlanEvent = typeof SubscriptionPlanEventSchema.Type
