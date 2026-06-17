import { describe, expect, it } from 'vitest'
import type { CashMovement, CashMovementKind } from '../types/cash-movement'
import { buildCashMovementsCsv } from './cash-movement-csv'

function mv(
  overrides: Partial<CashMovement> & {
    id: string
    kind: CashMovementKind
    amountCents: number
    createdAt: string
  },
): CashMovement {
  const {
    kind,
    orderId,
    paymentMethod,
    expenseCategoryId,
    direction: _direction,
    ...rest
  } = overrides
  const common = { tenantId: 't1', unitId: 'u1', description: null, recordedByUid: 'u1', ...rest }
  switch (kind) {
    case 'sale':
      return {
        ...common,
        kind,
        direction: 'in',
        orderId: orderId ?? 'o1',
        paymentMethod: paymentMethod ?? null,
        expenseCategoryId: null,
      }
    case 'sale_reversal':
      return {
        ...common,
        kind,
        direction: 'out',
        orderId: orderId ?? 'o1',
        paymentMethod: paymentMethod ?? null,
        expenseCategoryId: null,
      }
    case 'despesa':
      return {
        ...common,
        kind,
        direction: 'out',
        orderId: null,
        paymentMethod: null,
        expenseCategoryId: expenseCategoryId ?? null,
      }
    case 'sangria':
      return {
        ...common,
        kind,
        direction: 'out',
        orderId: null,
        paymentMethod: null,
        expenseCategoryId: null,
      }
    case 'suprimento':
      return {
        ...common,
        kind,
        direction: 'in',
        orderId: null,
        paymentMethod: null,
        expenseCategoryId: null,
      }
  }
}

describe('buildCashMovementsCsv', () => {
  it('emits a UTF-8 BOM + CRLF and the expected header', () => {
    const csv = buildCashMovementsCsv([])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.split('\r\n')
    expect(lines[0]).toMatch(/^\uFEFFdata,unidade,tipo,direção,valor \(R\$\)/)
  })

  it('formats amounts in BRL with comma decimals', () => {
    const csv = buildCashMovementsCsv([
      mv({ id: 'a', kind: 'sale', amountCents: 12345, createdAt: '2026-05-10T10:00:00.000Z' }),
    ])
    expect(csv).toContain('123,45')
  })

  it('resolves unit and expense category names from lookup maps', () => {
    const csv = buildCashMovementsCsv(
      [
        mv({
          id: 'a',
          kind: 'despesa',
          amountCents: 5000,
          unitId: 'u1',
          expenseCategoryId: 'cat-rent',
          createdAt: '2026-05-10T12:00:00.000Z',
        }),
      ],
      {
        unitNameById: { u1: 'Matriz' },
        expenseCategoryNameById: { 'cat-rent': 'Aluguel' },
      },
    )
    expect(csv).toContain('Matriz')
    expect(csv).toContain('Aluguel')
  })

  it('quotes values that contain commas, quotes, or newlines', () => {
    const csv = buildCashMovementsCsv([
      mv({
        id: 'a',
        kind: 'despesa',
        amountCents: 100,
        description: 'item, com "aspas" e\nquebra',
        createdAt: '2026-05-10T12:00:00.000Z',
      }),
    ])
    // Aspas internas viram duplas, e o campo inteiro vai entre aspas.
    expect(csv).toContain('"item, com ""aspas"" e\nquebra"')
  })

  it('falls back to ids when lookup maps are missing the key', () => {
    const csv = buildCashMovementsCsv([
      mv({
        id: 'a',
        kind: 'despesa',
        amountCents: 100,
        unitId: 'unknown-unit',
        expenseCategoryId: 'unknown-cat',
        createdAt: '2026-05-10T12:00:00.000Z',
      }),
    ])
    expect(csv).toContain('unknown-unit')
    expect(csv).toContain('unknown-cat')
  })
})
