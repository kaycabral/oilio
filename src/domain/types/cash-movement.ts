import { Schema } from 'effect'

import { NonEmptyString } from '@/domain/value-objects'
import { PaymentMethod } from './order'

export const CASH_MOVEMENT_KINDS = [
  'sale',
  'sale_reversal',
  'sangria',
  'suprimento',
  'despesa',
] as const
export const CashMovementKind = Schema.Literal(...CASH_MOVEMENT_KINDS)
export type CashMovementKind = typeof CashMovementKind.Type

export const CashMovementDirection = Schema.Literal('in', 'out')
export type CashMovementDirection = typeof CashMovementDirection.Type

const cashMovementCommonFields = {
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  amountCents: Schema.Number,
  description: Schema.NullOr(Schema.String),
  recordedByUid: NonEmptyString,
  createdAt: Schema.String,
}

const SaleMovement = Schema.mutable(
  Schema.Struct({
    ...cashMovementCommonFields,
    kind: Schema.Literal('sale'),
    direction: Schema.Literal('in'),
    orderId: Schema.String,
    paymentMethod: Schema.NullOr(PaymentMethod),
    expenseCategoryId: Schema.Null,
  }),
)
const SaleReversalMovement = Schema.mutable(
  Schema.Struct({
    ...cashMovementCommonFields,
    kind: Schema.Literal('sale_reversal'),
    direction: Schema.Literal('out'),
    orderId: Schema.String,
    paymentMethod: Schema.NullOr(PaymentMethod),
    expenseCategoryId: Schema.Null,
  }),
)
const DespesaMovement = Schema.mutable(
  Schema.Struct({
    ...cashMovementCommonFields,
    kind: Schema.Literal('despesa'),
    direction: Schema.Literal('out'),
    orderId: Schema.Null,
    paymentMethod: Schema.Null,
    expenseCategoryId: Schema.NullOr(Schema.String),
  }),
)
const SangriaMovement = Schema.mutable(
  Schema.Struct({
    ...cashMovementCommonFields,
    kind: Schema.Literal('sangria'),
    direction: Schema.Literal('out'),
    orderId: Schema.Null,
    paymentMethod: Schema.Null,
    expenseCategoryId: Schema.Null,
  }),
)
const SuprimentoMovement = Schema.mutable(
  Schema.Struct({
    ...cashMovementCommonFields,
    kind: Schema.Literal('suprimento'),
    direction: Schema.Literal('in'),
    orderId: Schema.Null,
    paymentMethod: Schema.Null,
    expenseCategoryId: Schema.Null,
  }),
)

export const CashMovement = Schema.Union(
  SaleMovement,
  SaleReversalMovement,
  DespesaMovement,
  SangriaMovement,
  SuprimentoMovement,
)
export type CashMovement = typeof CashMovement.Type
export type SaleMovement = typeof SaleMovement.Type
