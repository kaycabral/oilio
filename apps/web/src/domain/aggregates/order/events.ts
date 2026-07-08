import { OpenOrder, OrderItem, PaymentMethod } from '@/domain/types/order'
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

// `items` snapshot (schemaVersion 2, ADR 0016 D5): the closed order IS the sale,
// and revenue is recognised per item — the finest grain of the fact. Carrying the
// items on the event makes per-item revenue derivable FROM THE EVENT ALONE (no
// replay, no projection read), which is what lets the Razão derive from the stream
// by competência. Mirrors `commission.created`, which already snapshots per item.
// Legacy v1 `order.closed` (no items) is lifted by the order upcaster (config.ts).
export const OrderClosedSchema = Schema.Struct({
  _tag: Schema.Literal('order.closed'),
  closedAt: Schema.String,
  subtotalCents: Schema.Number,
  totalCents: Schema.Number,
  paymentMethod: Schema.NullOr(PaymentMethod),
  items: Schema.mutable(Schema.Array(OrderItem)),
  // `unitId` snapshotted for the SAME reason as `items` (ADR 0016 D5): it makes
  // the closed order's revenue self-locating from the event alone — the Razão
  // reads the org+window stream (never per-aggregate replay), so it can't reach
  // `order.created` for the unit. The commission inherits this unit via the
  // correlated order. Legacy v1 `order.closed` (no unitId) is lifted by the
  // order upcaster to '' — a pre-D5 closed order simply lands unit-less, never a
  // decode failure (production has ZERO closed events; verified).
  unitId: Schema.String,
})

// `reopenedAt` is the competência of the reversal (when the sale is undone);
// `reversedClosedAt` is the competência of the ORIGINAL sale being reversed
// (ADR 0016 D3/D5). The Razão needs both: the reversing entry lands on the
// reversal's competência (current period if the sale's period is closed), and it
// must know which sale it offsets. Legacy v1 `order.reopened` (neither field) is
// lifted by the order upcaster (config.ts).
export const OrderReopenedSchema = Schema.Struct({
  _tag: Schema.Literal('order.reopened'),
  reopenedAt: Schema.String,
  reversedClosedAt: Schema.String,
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
