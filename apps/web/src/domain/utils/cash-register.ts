import type { CashMovement, CashMovementDirection, CashMovementKind } from '../types/cash-movement'
import type { PaymentMethod } from '../types/order'

export function getMovementDirection(kind: CashMovementKind): CashMovementDirection {
  if (kind === 'sale' || kind === 'suprimento') return 'in'
  // sale_reversal, sangria, despesa → saída.
  return 'out'
}

// Só dinheiro afeta o saldo físico do caixa. Outros métodos (pix/cartão)
// entram como movement de `sale` pra trilha contábil completa, mas não
// movem o caixa físico — `expectedClosingBalanceCents` ignora.
export function isCashPaymentMethod(method: PaymentMethod | null): boolean {
  return method === 'cash'
}

// Resumo agregado de um caixa (ou intervalo) — usado em listas, relatório
// diário, e cálculo de `expectedClosingBalance` no fechamento.
export type CashMovementTotals = {
  // Soma de tudo que entra/sai (independente do método).
  totalInCents: number
  totalOutCents: number
  // Apenas movements em dinheiro afetam o saldo físico esperado.
  cashInCents: number
  cashOutCents: number
  // Por categoria — útil pro relatório diário.
  salesByMethod: Record<PaymentMethod, number>
  sangriaCents: number
  suprimentoCents: number
  despesaCents: number
  count: number
}

const ZERO_SALES_BY_METHOD: Record<PaymentMethod, number> = {
  cash: 0,
  credit_card: 0,
  debit_card: 0,
  pix: 0,
}

// Regra de "dinheiro": `kind === 'sale'` só conta como cash se o paymentMethod
// for `cash`. Pra qualquer outro kind (opening, sangria, suprimento, despesa),
// o paymentMethod é null ou irrelevante — eles são sempre em dinheiro físico.
function affectsCashBalance(m: CashMovement): boolean {
  // `sale` e `sale_reversal` só mexem no caixa físico se forem em dinheiro
  // (pix/cartão entram na trilha mas não movem a gaveta). Os demais kinds são
  // sempre dinheiro físico.
  if (m.kind === 'sale' || m.kind === 'sale_reversal') return isCashPaymentMethod(m.paymentMethod)
  return true
}

function accumulateDirection(totals: CashMovementTotals, m: CashMovement): void {
  const isCash = affectsCashBalance(m)
  if (m.direction === 'in') {
    totals.totalInCents += m.amountCents
    if (isCash) totals.cashInCents += m.amountCents
  } else {
    totals.totalOutCents += m.amountCents
    if (isCash) totals.cashOutCents += m.amountCents
  }
}

function accumulateKind(totals: CashMovementTotals, m: CashMovement): void {
  switch (m.kind) {
    case 'sale':
      if (m.paymentMethod) totals.salesByMethod[m.paymentMethod] += m.amountCents
      return
    case 'sale_reversal':
      // Estorno reduz a venda líquida do método correspondente.
      if (m.paymentMethod) totals.salesByMethod[m.paymentMethod] -= m.amountCents
      return
    case 'sangria':
      totals.sangriaCents += m.amountCents
      return
    case 'suprimento':
      totals.suprimentoCents += m.amountCents
      return
    case 'despesa':
      totals.despesaCents += m.amountCents
      return
  }
}

export function computeMovementTotals(movements: readonly CashMovement[]): CashMovementTotals {
  const totals: CashMovementTotals = {
    totalInCents: 0,
    totalOutCents: 0,
    cashInCents: 0,
    cashOutCents: 0,
    salesByMethod: { ...ZERO_SALES_BY_METHOD },
    sangriaCents: 0,
    suprimentoCents: 0,
    despesaCents: 0,
    count: movements.length,
  }
  for (const m of movements) {
    accumulateDirection(totals, m)
    accumulateKind(totals, m)
  }
  return totals
}
