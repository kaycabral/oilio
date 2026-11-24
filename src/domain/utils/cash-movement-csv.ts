import type { CashMovement } from '../types/cash-movement'

type LookupMaps = {
  unitNameById?: Record<string, string>
  expenseCategoryNameById?: Record<string, string>
}

const HEADER_ROW = [
  'data',
  'unidade',
  'tipo',
  'direção',
  'valor (R$)',
  'forma de pagamento',
  'categoria de despesa',
  'order',
  'descrição',
] as const

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatAmountBR(amountCents: number): string {
  const reais = (amountCents / 100).toFixed(2).replace('.', ',')
  return reais
}

export function buildCashMovementsCsv(
  movements: readonly CashMovement[],
  maps: LookupMaps = {},
): string {
  const lines: string[] = []
  lines.push(HEADER_ROW.map(csvEscape).join(','))
  for (const m of movements) {
    const unitName = maps.unitNameById?.[m.unitId] ?? m.unitId
    const expenseCategoryName = m.expenseCategoryId
      ? (maps.expenseCategoryNameById?.[m.expenseCategoryId] ?? m.expenseCategoryId)
      : ''
    lines.push(
      [
        m.createdAt,
        unitName,
        m.kind,
        m.direction,
        formatAmountBR(m.amountCents),
        m.paymentMethod ?? '',
        expenseCategoryName,
        m.orderId ?? '',
        m.description ?? '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
