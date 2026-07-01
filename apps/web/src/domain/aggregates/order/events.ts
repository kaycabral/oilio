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

// Attach / detach / swap the order's customer AFTER it was opened (#1321 / brief
// 0081). A walk-in sale is born anonymous (`customerId: null`) and was immutable
// on the customer; this event makes it assignable while the order is open, so a
// balcão sale can inherit the 0079 subscription-coverage machine. `customerId` is
// nullable: a value links (or swaps) the customer, `null` unlinks — one event
// mirrors the nullable read-model field, so link/unlink/swap stay symmetric by
// construction. PII never rides the payload — only the id (ADR 0010 D2).
export const OrderCustomerAssignedSchema = Schema.Struct({
  _tag: Schema.Literal('order.customer_assigned'),
  customerId: Schema.NullOr(Schema.String),
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
  OrderCustomerAssignedSchema,
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
export type OrderCustomerAssigned = typeof OrderCustomerAssignedSchema.Type
export type OrderCancelled = typeof OrderCancelledSchema.Type
export type OrderClosed = typeof OrderClosedSchema.Type
export type OrderReopened = typeof OrderReopenedSchema.Type
export type OrderEvent = typeof OrderEventSchema.Type
