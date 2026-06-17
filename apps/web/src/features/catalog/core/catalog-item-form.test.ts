import type { CatalogItem } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  filterCatalogItems,
  normalizeKindFilter,
  parseCommissionFromForm,
  parseUnitOverrides,
} from './catalog-item-form'

function makeForm(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v)
    } else {
      fd.set(key, value)
    }
  }
  return fd
}

describe('parseCommissionFromForm', () => {
  it('retorna null para none/vazio', () => {
    expect(parseCommissionFromForm('k', 'v', makeForm({ k: 'none' }))).toBeNull()
    expect(parseCommissionFromForm('k', 'v', makeForm({}))).toBeNull()
  })

  it('rejeita kind inválido', () => {
    expect(parseCommissionFromForm('k', 'v', makeForm({ k: 'bogus' }))).toBe(
      'Tipo de comissão inválido',
    )
  })

  it('rejeita valor negativo', () => {
    expect(parseCommissionFromForm('k', 'v', makeForm({ k: 'percentage', v: '-1' }))).toBe(
      'Valor de comissão inválido',
    )
  })

  it('percentage usa o valor cru; fixed converte reais → centavos', () => {
    expect(parseCommissionFromForm('k', 'v', makeForm({ k: 'percentage', v: '10' }))).toEqual({
      kind: 'percentage',
      value: 10,
    })
    expect(parseCommissionFromForm('k', 'v', makeForm({ k: 'fixed', v: '12,50' }))).toEqual({
      kind: 'fixed',
      value: 1250,
    })
  })
})

describe('parseUnitOverrides', () => {
  it('null quando nenhuma unidade tem override', () => {
    expect(parseUnitOverrides(makeForm({}), ['u1', 'u2'])).toBeNull()
  })

  it('coleta o override de preço de uma unidade', () => {
    const result = parseUnitOverrides(makeForm({ override_u1__priceCents: '30,00' }), ['u1', 'u2'])
    expect(result).toEqual({ u1: { priceCents: 3000 } })
  })

  it('propaga erro de duração inválida com o id da unidade', () => {
    expect(parseUnitOverrides(makeForm({ override_u1__durationMinutes: '0' }), ['u1'])).toBe(
      'Duração da exceção inválida (unit u1)',
    )
  })
})

describe('normalizeKindFilter', () => {
  it('passa service/product e cai pra all', () => {
    expect(normalizeKindFilter('service')).toBe('service')
    expect(normalizeKindFilter('product')).toBe('product')
    expect(normalizeKindFilter(undefined)).toBe('all')
    expect(normalizeKindFilter('xxx')).toBe('all')
  })
})

describe('filterCatalogItems', () => {
  const items: Pick<CatalogItem, 'kind' | 'categoryId'>[] = [
    { kind: 'service', categoryId: 'cat-a' },
    { kind: 'product', categoryId: null },
    { kind: 'service', categoryId: 'cat-b' },
  ]

  it('all + sem categoria retorna tudo', () => {
    expect(filterCatalogItems(items, 'all', '')).toHaveLength(3)
  })

  it('filtra por kind', () => {
    expect(filterCatalogItems(items, 'service', '')).toHaveLength(2)
  })

  it('__none pega só os sem categoria', () => {
    const r = filterCatalogItems(items, 'all', '__none')
    expect(r).toEqual([{ kind: 'product', categoryId: null }])
  })

  it('filtra por categoria específica', () => {
    expect(filterCatalogItems(items, 'all', 'cat-b')).toEqual([
      { kind: 'service', categoryId: 'cat-b' },
    ])
  })
})
