import { Schema } from 'effect'

import { PaymentMethod } from './order'

// Financeiro V0 (brief 0031): só movimentos automáticos da venda. A gaveta
// manual (sangria/suprimento/despesa) foi removida da UI — o tipo ainda os
// enumera para projetar/exibir documentos legados (replay, CSV), mas nenhuma
// operação manual os emite.
// - sale: gerado quando a parte vendida em dinheiro de uma comanda fecha
//   (sempre, sem depender de caixa aberto). Mantém ref ao orderId.
// - sale_reversal: gerado quando o fechamento de uma order é desfeito (undo).
//   Compensação append-only (nunca deletamos o `sale`): movimento de saída que
//   estorna a venda, mantendo `orderId`. Espelha o paymentMethod da venda.
// - sangria/suprimento/despesa: legados da gaveta manual (brief 0015), sem
//   emissor ativo após o 0031.
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
  tenantId: Schema.String,
  unitId: Schema.String,
  // Sempre positivo. `direction` carrega o sinal.
  amountCents: Schema.Number,
  description: Schema.NullOr(Schema.String),
  recordedByUid: Schema.String,
  createdAt: Schema.String,
}

// União discriminada por `kind`. Cada natureza fixa o sinal (`direction`) e quais
// vínculos existem: `sale`/`sale_reversal` carregam `orderId`; `despesa` carrega
// `expenseCategoryId`; `sangria`/`suprimento` não têm vínculo. Vínculos não
// aplicáveis ficam `null` (campos ES sob merge — ver convenção do projeto).
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
