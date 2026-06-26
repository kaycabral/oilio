import { OpenOrder, PaymentMethod } from '@/domain/types/order'
import { Schema } from 'effect'

// Orders are always born open; item/meta edits only apply while open. Both ride
// the open branch so the event payloads can't carry a closed/cancelled shape.
export const OrderCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('order.created'),
  data: OpenOrder,
})

const OrderChanges = Schema.partial(OpenOrder)

export const OrderItemAddedSchema = Schema.Struct({
  _tag: Schema.Literal('order.item_added'),
  changes: OrderChanges,
})

export const OrderItemRemovedSchema = Schema.Struct({
  _tag: Schema.Literal('order.item_removed'),
  changes: OrderChanges,
})

export const OrderItemAttributionChangedSchema = Schema.Struct({
  _tag: Schema.Literal('order.item_attribution_changed'),
  changes: OrderChanges,
})

export const OrderItemCoverageChangedSchema = Schema.Struct({
  _tag: Schema.Literal('order.item_coverage_changed'),
  changes: OrderChanges,
})

export const OrderMetaUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('order.meta_updated'),
  changes: OrderChanges,
})

export const OrderCancelledSchema = Schema.Struct({
  _tag: Schema.Literal('order.cancelled'),
})

export const OrderClosedSchema = Schema.Struct({
  _tag: Schema.Literal('order.closed'),
  closedAt: Schema.String,
  subtotalCents: Schema.Number,
  totalCents: Schema.Number,
  paymentMethod: Schema.NullOr(PaymentMethod),
})

export const OrderReopenedSchema = Schema.Struct({
  _tag: Schema.Literal('order.reopened'),
  commissionsReversed: Schema.Number,
  cashReversalMovementId: Schema.NullOr(Schema.String),
  subscriptionRestored: Schema.Boolean,
})

export const OrderEventSchema = Schema.Union(
  OrderCreatedSchema,
  OrderItemAddedSchema,
  OrderItemRemovedSchema,
  OrderItemAttributionChangedSchema,
  OrderItemCoverageChangedSchema,
  OrderMetaUpdatedSchema,
  OrderCancelledSchema,
  OrderClosedSchema,
  OrderReopenedSchema,
)

export type OrderCreated = typeof OrderCreatedSchema.Type
export type OrderItemAdded = typeof OrderItemAddedSchema.Type
export type OrderItemRemoved = typeof OrderItemRemovedSchema.Type
export type OrderItemAttributionChanged = typeof OrderItemAttributionChangedSchema.Type
export type OrderItemCoverageChanged = typeof OrderItemCoverageChangedSchema.Type
export type OrderMetaUpdated = typeof OrderMetaUpdatedSchema.Type
export type OrderCancelled = typeof OrderCancelledSchema.Type
export type OrderClosed = typeof OrderClosedSchema.Type
export type OrderReopened = typeof OrderReopenedSchema.Type
export type OrderEvent = typeof OrderEventSchema.Type
