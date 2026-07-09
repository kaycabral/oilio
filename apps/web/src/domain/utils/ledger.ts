import type { Charge } from '@/domain/types/charge'
import type { Commission } from '@/domain/types/commission'
import { type LedgerEntry, type LedgerNature } from '@/domain/types/ledger'
import { coverageOf, type OrderItem } from '@/domain/types/order'
import { computeItemLineTotal } from '@/domain/utils/order'
import { Money } from '@/domain/value-objects'

// Classificação-na-origem do Razão (brief 0091, AC-02). Funções puras que mapeiam
// cada fato do EVENT STREAM pra `LedgerEntry[]` com as 3 dimensões e defaults, por
// COMPETÊNCIA (ADR 0016): venda no `closedAt`, assinatura na competência do
// período de serviço, estorno na competência do estorno. O dono nunca etiqueta à
// mão; nenhum evento de razão é emitido (ADR 0010 D4 — o Razão deriva do stream,
// não o reemite). O fato é auto-suficiente: `order.closed` carrega o snapshot dos
// items (ADR 0016 D5), então a receita por item deriva do evento só, sem replay
// nem projeção.
//
// A entrada é o STREAM da org+janela (não fatos isolados): a classificação
// correlaciona fatos — a comissão herda a `unitId` do `order.closed` da mesma
// comanda (a comissão não carrega unidade; brief 0091). Por isso a API canônica é
// `classifyLedger(facts)`, não uma função por fato. Regra: a classificação vive
// numa ÚNICA função pura aqui (CLAUDE.md do domínio, #B4).

// Fato financeiro extraído do stream, discriminado por origem. O adapter (Onda 1)
// monta esta lista a partir de `readOrgEventStream`; o core classifica sem I/O.
export type LedgerFact =
  | { readonly kind: 'order_closed'; readonly order: ClosedOrderFact }
  | { readonly kind: 'order_reopened'; readonly reopen: OrderReopenedFact }
  | { readonly kind: 'commission'; readonly commission: Commission }
  | { readonly kind: 'charge_succeeded'; readonly charge: Charge }
  | { readonly kind: 'charge_refunded'; readonly charge: Charge }

// A comanda fechada tal como o evento `order.closed` a carrega (ADR 0016 D5):
// identidade + unidade + a competência (`closedAt`) + o snapshot dos items.
export type ClosedOrderFact = {
  readonly id: string
  readonly orgId: string
  readonly unitId: string
  readonly closedAt: string
  readonly items: readonly OrderItem[]
}

// O estorno tal como `order.reopened` o carrega: a comanda estornada, as duas
// competências (do estorno e da venda original), a receita reconhecida a estornar
// e a unidade — TODOS snapshotados no evento (ADR 0016 D5). O evento é
// auto-suficiente: a venda original pode estar fora da janela lida (fechou dia 30,
// reabriu dia 1), então o valor/unidade NÃO podem ser correlacionados da comanda
// fechada in-window — vêm do próprio evento de estorno.
export type OrderReopenedFact = {
  readonly orderId: string
  readonly orgId: string
  readonly unitId: string
  readonly reopenedAt: string
  readonly reversedClosedAt: string
  readonly reversedRevenueCents: number
}

type Direction = 'in' | 'out'

function entry(fields: {
  orgId: string
  unitId: string
  nature: LedgerNature
  behavior: 'variable' | 'fixed'
  link: 'item' | 'sale' | 'unit'
  amountCents: number
  direction: Direction
  source: LedgerEntry['source']
  sourceId: string
  itemId: string | null
  occurredAt: string
}): LedgerEntry {
  const idParts = [fields.source, fields.sourceId, fields.itemId ?? undefined].filter(
    (p): p is string => p !== undefined,
  )
  return {
    id: idParts.join(':'),
    orgId: fields.orgId,
    unitId: fields.unitId,
    nature: fields.nature,
    behavior: fields.behavior,
    link: fields.link,
    // Money brand recusa negativo/não-int no boundary — a invariante "valor
    // positivo, sinal na direção" é do tipo, não só convenção.
    amountCents: Money(Math.abs(fields.amountCents)),
    direction: fields.direction,
    source: fields.source,
    sourceId: fields.sourceId,
    itemId: fields.itemId,
    occurredAt: fields.occurredAt,
  }
}

// Receita reconhecida de uma comanda: soma dos itens `coverage === 'sale'` (item
// coberto por assinatura debita o plano, não gera receita — brief 0021). Fonte
// ÚNICA do valor de venda avulsa: `classifyClosedOrder` a distribui por item; o
// produtor de `order.reopened` a snapshota no evento pra o estorno ser correto sem
// correlacionar a comanda fechada (ADR 0016 D5).
export function recognizedSaleRevenueCents(items: readonly OrderItem[]): number {
  return items
    .filter((item) => coverageOf(item) === 'sale')
    .reduce((sum, item) => sum + computeItemLineTotal(item), 0)
}

// Receita avulsa da comanda fechada — por item (granularidade base). Só itens
// `coverage === 'sale'` viram receita: item coberto por assinatura debita saldo do
// plano, não gera receita (brief 0021). Competência = `closedAt` (ADR 0016 D2).
function classifyClosedOrder(order: ClosedOrderFact): LedgerEntry[] {
  return order.items
    .filter((item) => coverageOf(item) === 'sale')
    .map((item) =>
      entry({
        orgId: order.orgId,
        unitId: order.unitId,
        nature: 'revenue',
        behavior: 'variable',
        link: 'item',
        amountCents: computeItemLineTotal(item),
        direction: 'in',
        source: 'order',
        sourceId: order.id,
        itemId: item.id,
        occurredAt: order.closedAt,
      }),
    )
}

// Comissão = CSP (custo do serviço prestado): custo variável direto, atrelado ao
// item da venda. Sai do resultado (`out`). A `unitId` NÃO vem da comissão (que não
// a carrega) — é resolvida do `order.closed` correlato (mesma `orderId`) pelo
// chamador. Competência = a mesma da venda (a comissão nasce no fechamento).
function classifyCommission(
  commission: Commission,
  unitId: string,
  occurredAt: string,
): LedgerEntry[] {
  if (commission.amountCents <= 0) return []
  return [
    entry({
      orgId: commission.orgId,
      unitId,
      nature: 'csp',
      behavior: 'variable',
      link: 'item',
      amountCents: commission.amountCents,
      direction: 'out',
      source: 'commission',
      sourceId: commission.id,
      itemId: commission.orderItemId,
      occurredAt,
    }),
  ]
}

// Receita recorrente de assinatura, reconhecida por COMPETÊNCIA do período de
// serviço (ADR 0016 D2) — `periodStartAt`, NÃO `paidAt` (que é caixa). V0: 1
// lançamento na competência do período (ciclo mensal alinhado ≈ 1 mês; ADR 0016
// D2 "Escolha de V0"). O pro-rata multi-período entra quando houver ciclo
// anual/atrasado, sem remodelar (a competência já é derivada do período). Sem item
// natural → `link: 'sale'`.
function classifyChargeRevenue(charge: Charge): LedgerEntry[] {
  if (charge.amountCents <= 0) return []
  return [
    entry({
      orgId: charge.orgId,
      unitId: charge.unitId,
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      amountCents: charge.amountCents,
      direction: 'in',
      source: 'charge',
      sourceId: charge.id,
      itemId: null,
      occurredAt: charge.periodStartAt,
    }),
  ]
}

// Estorno de assinatura (`charge.refunded`, ADR 0016 D3): lançamento de
// contrapartida — `revenue` + `direction: 'out'` — na competência do estorno
// (`refundedAt`), nunca reescrevendo o lançamento original. Se o período da receita
// estornada já fechou, a contrapartida cai na competência do estorno (período
// corrente), preservando a imutabilidade do período fechado.
function classifyChargeRefund(charge: Charge): LedgerEntry[] {
  if (charge.amountCents <= 0 || charge.refundedAt === null) return []
  return [
    entry({
      orgId: charge.orgId,
      unitId: charge.unitId,
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      amountCents: charge.amountCents,
      direction: 'out',
      source: 'charge',
      sourceId: `${charge.id}:refund`,
      itemId: null,
      occurredAt: charge.refundedAt,
    }),
  ]
}

// Estorno de venda avulsa (`order.reopened`, ADR 0016 D3): contrapartida da receita
// da comanda reaberta. Competência = `reopenedAt` (a data do estorno), preservando
// a imutabilidade do período em que a venda foi reconhecida. O valor a estornar e a
// unidade vêm SNAPSHOTADOS no próprio evento (`reversedRevenueCents`, `unitId`) —
// não da comanda fechada correlata, que pode estar fora da janela lida.
function classifyOrderReopened(
  reopen: OrderReopenedFact,
  reversedRevenueCents: number,
): LedgerEntry[] {
  if (reversedRevenueCents <= 0) return []
  return [
    entry({
      orgId: reopen.orgId,
      unitId: reopen.unitId,
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      amountCents: reversedRevenueCents,
      direction: 'out',
      source: 'order',
      sourceId: `${reopen.orderId}:reopen:${reopen.reopenedAt}`,
      itemId: null,
      occurredAt: reopen.reopenedAt,
    }),
  ]
}

// Classifica o STREAM inteiro da org+janela num Razão. Correlaciona fatos: a
// comissão herda `unitId`+competência do `order.closed` da mesma comanda; o
// `order.reopened` estorna a receita reconhecida daquela venda. O que não tem
// correlato (comissão órfã, reopen de venda fora da janela) é ignorado com
// segurança — o Razão soma o que consegue fundamentar.
export function classifyLedger(facts: readonly LedgerFact[]): LedgerEntry[] {
  // Índice das comandas fechadas por orderId — fonte de unidade/competência das
  // COMISSÕES (que não carregam unidade). O estorno NÃO usa este índice: a venda
  // reaberta pode ter fechado numa janela anterior, então o valor a reverter + a
  // unidade vêm do próprio `order.reopened` (snapshot, ADR 0016 D5).
  const closedByOrderId = new Map<string, ClosedOrderFact>()
  for (const fact of facts) {
    if (fact.kind === 'order_closed') closedByOrderId.set(fact.order.id, fact.order)
  }

  const entries: LedgerEntry[] = []
  for (const fact of facts) {
    switch (fact.kind) {
      case 'order_closed':
        entries.push(...classifyClosedOrder(fact.order))
        break
      case 'commission': {
        const order = closedByOrderId.get(fact.commission.orderId)
        // Comissão sem comanda fechada na janela — ignora.
        if (!order) break
        entries.push(...classifyCommission(fact.commission, order.unitId, order.closedAt))
        break
      }
      case 'charge_succeeded':
        entries.push(...classifyChargeRevenue(fact.charge))
        break
      case 'charge_refunded':
        entries.push(...classifyChargeRefund(fact.charge))
        break
      case 'order_reopened':
        // Valor + unidade do próprio evento (auto-suficiente): correto mesmo se a
        // venda original fechou fora da janela lida.
        entries.push(...classifyOrderReopened(fact.reopen, fact.reopen.reversedRevenueCents))
        break
    }
  }
  return entries
}
