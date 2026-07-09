import { Schema } from 'effect'

import { NonEmptyString, NonNegativeInt } from '@/domain/value-objects'
import { CommissionRule } from './member-operation'

export const ORDER_STATUSES = ['open', 'closed', 'cancelled'] as const
export const OrderStatus = Schema.Literal(...ORDER_STATUSES)
export type OrderStatus = typeof OrderStatus.Type

export const PAYMENT_METHODS = ['cash', 'credit_card', 'debit_card', 'pix'] as const
export const PaymentMethod = Schema.Literal(...PAYMENT_METHODS)
export type PaymentMethod = typeof PaymentMethod.Type

export const ORDER_ITEM_KINDS = ['service', 'product'] as const
export const OrderItemKind = Schema.Literal(...ORDER_ITEM_KINDS)
export type OrderItemKind = typeof OrderItemKind.Type

export const ORDER_COVERAGES = ['sale', 'subscription'] as const
export const OrderCoverage = Schema.Literal(...ORDER_COVERAGES)
export type OrderCoverage = typeof OrderCoverage.Type

export function coverageOf(item: { coverage?: OrderCoverage }): OrderCoverage {
  return item.coverage ?? 'sale'
}

export const OrderItem = Schema.mutable(
  Schema.Struct({
    id: NonEmptyString,
    kind: OrderItemKind,
    refId: NonEmptyString,
    name: NonEmptyString,
    quantity: Schema.Number,
    unitPriceCents: NonNegativeInt,
    commission: Schema.NullOr(CommissionRule),
    attributedUserId: NonEmptyString,
    coverage: Schema.optional(OrderCoverage),
    subscriptionId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)
export type OrderItem = typeof OrderItem.Type

const orderCommonFields = {
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  customerId: Schema.NullOr(Schema.String),
  appointmentId: Schema.NullOr(Schema.String),
  items: Schema.mutable(Schema.Array(OrderItem)),
  discountCents: NonNegativeInt,
  subtotalCents: NonNegativeInt,
  totalCents: NonNegativeInt,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

export const OpenOrder = Schema.mutable(
  Schema.Struct({
    ...orderCommonFields,
    status: Schema.Literal('open'),
    closedAt: Schema.Null,
    paymentMethod: Schema.Null,
  }),
)
export const ClosedOrder = Schema.mutable(
  Schema.Struct({
    ...orderCommonFields,
    status: Schema.Literal('closed'),
    closedAt: Schema.String,
    paymentMethod: Schema.NullOr(PaymentMethod),
  }),
)
export const CancelledOrder = Schema.mutable(
  Schema.Struct({
    ...orderCommonFields,
    status: Schema.Literal('cancelled'),
    closedAt: Schema.Null,
    paymentMethod: Schema.Null,
  }),
)

export const Order = Schema.Union(OpenOrder, ClosedOrder, CancelledOrder)
export type Order = typeof Order.Type
export type OpenOrder = typeof OpenOrder.Type
export type ClosedOrder = typeof ClosedOrder.Type
export type CancelledOrder = typeof CancelledOrder.Type
