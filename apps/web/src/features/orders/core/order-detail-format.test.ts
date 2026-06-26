import { describe, expect, it } from 'vitest'
import {
  attributionLabel,
  buildCatalogOptions,
  clampQuantity,
  filterCatalog,
  formatBRL,
  normalizeSearch,
  statusLine,
  type CatalogOption,
} from './order-detail-format'

describe('formatBRL', () => {
  it('formats cents as BRL currency', () => {
    expect(formatBRL(8000)).toBe('R$ 80,00')
    expect(formatBRL(0)).toBe('R$ 0,00')
    expect(formatBRL(1)).toBe('R$ 0,01')
  })
})

describe('attributionLabel', () => {
  it('labels a service line "Executor" and a product line "Vendedor"', () => {
    expect(attributionLabel('service')).toBe('Executor')
    expect(attributionLabel('product')).toBe('Vendedor')
  })
})

describe('statusLine', () => {
  it('reports an open order with its creation time', () => {
    expect(
      statusLine({
        status: 'open',
        createdAt: '2026-06-15T13:00:00.000Z',
        updatedAt: '2026-06-15T13:00:00.000Z',
        closedAt: null,
        paymentMethod: null,
      }),
    ).toMatch(/^Aberta em /)
  })

  it('reports a cancelled order with its update time', () => {
    expect(
      statusLine({
        status: 'cancelled',
        createdAt: '2026-06-15T13:00:00.000Z',
        updatedAt: '2026-06-16T13:00:00.000Z',
        closedAt: null,
        paymentMethod: null,
      }),
    ).toMatch(/^Cancelada em /)
  })

  it('reports a closed order with its payment label', () => {
    expect(
      statusLine({
        status: 'closed',
        createdAt: '2026-06-15T13:00:00.000Z',
        updatedAt: '2026-06-15T13:00:00.000Z',
        closedAt: '2026-06-15T14:00:00.000Z',
        paymentMethod: 'pix',
      }),
    ).toContain('· PIX')
  })

  it('falls back to em-dash when a closed order has no payment method', () => {
    const line = statusLine({
      status: 'closed',
      createdAt: '2026-06-15T13:00:00.000Z',
      updatedAt: '2026-06-15T13:00:00.000Z',
      closedAt: null,
      paymentMethod: null,
    })
    expect(line).toContain('Fechada em — · —')
  })
})

describe('normalizeSearch', () => {
  it('lowercases, strips accents and trims', () => {
    expect(normalizeSearch('  Pomada Capilar  ')).toBe('pomada capilar')
    expect(normalizeSearch('Tintura Açaí')).toBe('tintura acai')
  })
})

describe('buildCatalogOptions', () => {
  it('merges services + products and sorts by name (pt-BR)', () => {
    const options = buildCatalogOptions(
      [{ id: 's1', name: 'Corte', priceCents: 8000 }],
      [{ id: 'p1', name: 'Ácido', priceCents: 3000, sku: 'ACD-1' }],
    )
    expect(options.map((o) => o.name)).toEqual(['Ácido', 'Corte'])
    expect(options[0]).toEqual({
      id: 'p1',
      name: 'Ácido',
      priceCents: 3000,
      kind: 'product',
      code: 'ACD-1',
    })
    // services carry a null code (no SKU)
    expect(options[1]?.code).toBeNull()
  })
})

describe('filterCatalog', () => {
  const options: CatalogOption[] = [
    { id: 's1', name: 'Corte Masculino', priceCents: 8000, kind: 'service', code: null },
    { id: 'p1', name: 'Pomada', priceCents: 3000, kind: 'product', code: 'POM-42' },
  ]

  it('returns the full list for an empty/whitespace query', () => {
    expect(filterCatalog(options, '')).toHaveLength(2)
    expect(filterCatalog(options, '   ')).toHaveLength(2)
  })

  it('matches by name, accent/case-insensitive', () => {
    expect(filterCatalog(options, 'corte').map((o) => o.id)).toEqual(['s1'])
    // CÔRTE → lowercased + accent-stripped → "corte", still matches "Corte".
    expect(filterCatalog(options, 'CÔRTE').map((o) => o.id)).toEqual(['s1'])
  })

  it('matches a product by its code (SKU)', () => {
    expect(filterCatalog(options, 'pom-42').map((o) => o.id)).toEqual(['p1'])
  })

  it('returns nothing when neither name nor code matches', () => {
    expect(filterCatalog(options, 'xyz')).toHaveLength(0)
  })
})

describe('clampQuantity', () => {
  it('locks a service line to qty 1', () => {
    expect(clampQuantity(5, true)).toBe(1)
  })

  it('clamps a product line to [1, 999]', () => {
    expect(clampQuantity(0, false)).toBe(1)
    expect(clampQuantity(-3, false)).toBe(1)
    expect(clampQuantity(50, false)).toBe(50)
    expect(clampQuantity(2000, false)).toBe(999)
  })
})
