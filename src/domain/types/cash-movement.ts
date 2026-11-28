import { Schema, Struct } from 'effect'

import { NonEmptyString } from '@/domain/value-objects'
import { PaymentMethod } from './order'

export const CASH_MOVEMENT_KINDS = [
  'sale',
  'sale_reversal',
  'sangria',
  'suprimento',
  'despesa',
] as const
export const CashMovementKind = Schema.Literals(CASH_MOVEMENT_KINDS)
export type CashMovementKind = typeof CashMovementKind.Type

export const CashMovementDirection = Schema.Literals(['in', 'out'])
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

const SaleMovement = Schema.Struct({
  ...cashMovementCommonFields,
  kind: Schema.Literal('sale'),
  direction: Schema.Literal('in'),
  orderId: Schema.String,
  paymentMethod: Schema.NullOr(PaymentMethod),
  expenseCategoryId: Schema.Null,
}).mapFields(Struct.map(Schema.mutableKey))
const SaleReversalMovement = Schema.Struct({
  ...cashMovementCommonFields,
  kind: Schema.Literal('sale_reversal'),
  direction: Schema.Literal('out'),
  orderId: Schema.String,
  paymentMethod: Schema.NullOr(PaymentMethod),
  expenseCategoryId: Schema.Null,
}).mapFields(Struct.map(Schema.mutableKey))
const DespesaMovement = Schema.Struct({
  ...cashMovementCommonFields,
  kind: Schema.Literal('despesa'),
  direction: Schema.Literal('out'),
  orderId: Schema.Null,
  paymentMethod: Schema.Null,
  expenseCategoryId: Schema.NullOr(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
const SangriaMovement = Schema.Struct({
  ...cashMovementCommonFields,
  kind: Schema.Literal('sangria'),
  direction: Schema.Literal('out'),
  orderId: Schema.Null,
  paymentMethod: Schema.Null,
  expenseCategoryId: Schema.Null,
}).mapFields(Struct.map(Schema.mutableKey))
const SuprimentoMovement = Schema.Struct({
  ...cashMovementCommonFields,
  kind: Schema.Literal('suprimento'),
  direction: Schema.Literal('in'),
  orderId: Schema.Null,
  paymentMethod: Schema.Null,
  expenseCategoryId: Schema.Null,
}).mapFields(Struct.map(Schema.mutableKey))

export const CashMovement = Schema.Union([
  SaleMovement,
  SaleReversalMovement,
  DespesaMovement,
  SangriaMovement,
  SuprimentoMovement,
])
export type CashMovement = typeof CashMovement.Type
export type SaleMovement = typeof SaleMovement.Type
