import { Schema } from 'effect'

import { NonEmptyString, NonNegativeInt } from '@/domain/value-objects'
import { CommissionRule } from './member-operation'

export const ORDER_STATUSES = ['open', 'closed', 'cancelled'] as const
export const OrderStatus = Schema.Literal(...ORDER_STATUSES)
export type OrderStatus = typeof OrderStatus.Type

// Formas de pagamento são só instrumentos reais (brief 0021, AC-01). Consumo de
// assinatura NÃO é forma de pagamento — é cobertura por item (ver `OrderCoverage`).
export const PAYMENT_METHODS = ['cash', 'credit_card', 'debit_card', 'pix'] as const
export const PaymentMethod = Schema.Literal(...PAYMENT_METHODS)
export type PaymentMethod = typeof PaymentMethod.Type

export const ORDER_ITEM_KINDS = ['service', 'product'] as const
export const OrderItemKind = Schema.Literal(...ORDER_ITEM_KINDS)
export type OrderItemKind = typeof OrderItemKind.Type

// Natureza fiscal do item (brief 0021, AC-03): `sale` é venda real (compõe
// receita + total a pagar + base de NF futura + comissão/split); `subscription`
// é consumo de um benefício já cobrado (decrementa o saldo do plano, não gera
// receita/NF/comissão). Itens antigos sem o campo são lidos como `sale`.
export const ORDER_COVERAGES = ['sale', 'subscription'] as const
export const OrderCoverage = Schema.Literal(...ORDER_COVERAGES)
export type OrderCoverage = typeof OrderCoverage.Type

export function coverageOf(item: { coverage?: OrderCoverage }): OrderCoverage {
  return item.coverage ?? 'sale'
}

// Snapshot do item no momento que entrou na order. Não relê service/product
// no fechamento — preço/comissão podem mudar entre abrir e fechar, e a order
// precisa ser uma fotografia estável (auditoria + comissão calculada bate com
// o que cliente pagou).
export const OrderItem = Schema.mutable(
  Schema.Struct({
    // OrderItem vive no JSONB `items` de orders (sem CHECK/FK viável): a defesa
    // não-vazio (#1283 / brief 0078 AC-13) é só o decode do domínio.
    id: NonEmptyString,
    kind: OrderItemKind,
    // Referência ao item do catálogo unificado na hora do snapshot: aponta para
    // um doc da coleção `catalog_items` (brief 0023, AC-02). `kind` discrimina
    // serviço/produto, espelhando `CatalogItem.kind`. Itens legados podem ainda
    // apontar para `services`/`products` até a migração de consumidores (#1004).
    refId: NonEmptyString,
    name: NonEmptyString,
    // quantity fica fora do Grupo G (AC-16 [deferred]): sinal/zero dependem de regra.
    quantity: Schema.Number,
    unitPriceCents: NonNegativeInt,
    // Snapshot da regra de comissão. Produtos podem ter comissão nula (depende
    // do org); serviços geralmente têm. `null` = sem comissão pra este item.
    commission: Schema.NullOr(CommissionRule),
    // Membro a quem o item é atribuído (brief 0030, AC-04). Guarda o `userId`
    // GLOBAL do membro — NÃO o doc id de `MemberOperation` (que a recepção não tem)
    // nem o id da membership. A membership é derivável do path (`{tid}_{userId}`
    // via `membershipDocId`). Obrigatório, com default esperto (serviço de
    // agendamento → userId do profissional do appointment; produto/avulsa →
    // userId do membro que abriu). É o beneficiário da comissão (#1057). UI rotula
    // "Executor" (serviço) / "Vendedor" (produto) por `kind`, mas é um campo só.
    // Distinto do `actorId` do evento (quem operou). Validado no add/update.
    attributedUserId: NonEmptyString,
    // Natureza fiscal (brief 0021): `sale` (default) vira receita; `subscription`
    // debita o saldo do plano. Ausente em itens antigos → lido como `sale` via
    // `coverageOf`. `subscriptionId` é a assinatura debitada quando coberto.
    coverage: Schema.optional(OrderCoverage),
    subscriptionId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)
export type OrderItem = typeof OrderItem.Type

const orderCommonFields = {
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  // Cliente opcional (brief 0030, AC-02): venda avulsa de balcão pode ser
  // anônima (`null`). Venda nascida de agendamento sempre carrega o cliente do
  // appointment. `null` = venda sem cliente identificado (varejo/comércio).
  customerId: Schema.NullOr(Schema.String),
  // Quando aberta a partir de um agendamento, mantém o link. Permite marcar
  // o appointment como `completed` no fechamento + bloquear order dupla
  // pro mesmo agendamento.
  appointmentId: Schema.NullOr(Schema.String),
  items: Schema.mutable(Schema.Array(OrderItem)),
  discountCents: NonNegativeInt,
  // Cache dos totais — não é fonte de verdade (recalculados via
  // computeOrderTotals quando precisar), mas evita N reads pra montar listas.
  subtotalCents: NonNegativeInt,
  totalCents: NonNegativeInt,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

// União discriminada por `status`. Invariante sólido: `closedAt` é não-nulo SSE
// E SÓ SE `closed` (fechamento carimba a data); e `paymentMethod` só pode existir
// numa order fechada — uma fechada 100% coberta por assinatura (total 0) fecha
// sem pagamento, então ali `paymentMethod` segue opcional. "Aberta com closedAt",
// "fechada sem closedAt" e "aberta/cancelada com pagamento" ficam irrepresentáveis.
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
