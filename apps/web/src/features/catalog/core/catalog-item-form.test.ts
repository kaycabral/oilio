import type { CatalogItem } from '@/domain'
import {
  MIN_SEARCH_TERM_LENGTH as ENGINE_MIN_SEARCH_TERM_LENGTH,
  normalizeSearchTerm as engineNormalizeSearchTerm,
  type NameSearchResult,
} from '@cbrl/product'
import { describe, expect, it } from 'vitest'
import {
  clearedCodeState,
  codeNotice,
  deriveCodeState,
  filledFromSuggestion,
  filterCatalogItems,
  intrinsicsLocked,
  MIN_SEARCH_TERM_LENGTH,
  nameIsContribution,
  normalizeCodeInput,
  normalizeKindFilter,
  normalizeSearchTerm,
  parseCommissionFromForm,
  parseUnitOverrides,
  referenceGtinToWire,
  suggestionFromResult,
  type ProductIntrinsics,
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

describe('autofill — deriveCodeState', () => {
  const intrinsics: ProductIntrinsics = {
    name: 'Café torrado 500g',
    brand: 'Marca X',
    description: null,
    photoUrl: null,
    measures: null,
  }

  it('found → filled com os intrínsecos da base (boca código, sem gtin na state)', () => {
    expect(deriveCodeState({ status: 'found', intrinsics })).toEqual({
      kind: 'filled',
      intrinsics,
      source: 'code',
      gtin14: null,
    })
  })

  it('new → contributing (miss exige nome)', () => {
    expect(deriveCodeState({ status: 'new' })).toEqual({ kind: 'contributing' })
  })

  it('unrecognized → free com motivo unrecognized', () => {
    expect(deriveCodeState({ status: 'unrecognized' })).toEqual({
      kind: 'free',
      reason: 'unrecognized',
    })
  })

  it('unavailable → free com motivo unavailable (base off não trava)', () => {
    expect(deriveCodeState({ status: 'unavailable' })).toEqual({
      kind: 'free',
      reason: 'unavailable',
    })
  })
})

describe('autofill — estado e flags', () => {
  const intrinsics: ProductIntrinsics = {
    name: 'Leite 1L',
    brand: null,
    description: null,
    photoUrl: null,
    measures: null,
  }

  it('clearedCodeState é idle', () => {
    expect(clearedCodeState()).toEqual({ kind: 'idle' })
  })

  it('intrinsicsLocked só trava no hit (filled)', () => {
    expect(intrinsicsLocked({ kind: 'filled', intrinsics, source: 'code', gtin14: null })).toBe(
      true,
    )
    expect(intrinsicsLocked({ kind: 'idle' })).toBe(false)
    expect(intrinsicsLocked({ kind: 'contributing' })).toBe(false)
    expect(intrinsicsLocked({ kind: 'free', reason: 'unrecognized' })).toBe(false)
  })

  it('nameIsContribution só no miss (contributing)', () => {
    expect(nameIsContribution({ kind: 'contributing' })).toBe(true)
    expect(nameIsContribution({ kind: 'filled', intrinsics, source: 'code', gtin14: null })).toBe(
      false,
    )
    expect(nameIsContribution({ kind: 'idle' })).toBe(false)
    expect(nameIsContribution({ kind: 'free', reason: 'unavailable' })).toBe(false)
  })
})

describe('autofill — normalizeCodeInput', () => {
  it('apara espaços e remove separadores (scan = colar = digitar, AC-05)', () => {
    expect(normalizeCodeInput('  7891000 100-103 ')).toBe('7891000100103')
  })

  it('campo vazio vira string vazia', () => {
    expect(normalizeCodeInput('   ')).toBe('')
  })
})

describe('autofill — codeNotice (sem jargão, AC-04)', () => {
  const intrinsics: ProductIntrinsics = {
    name: 'X',
    brand: null,
    description: null,
    photoUrl: null,
    measures: null,
  }

  it('free/unavailable e free/unrecognized têm aviso leve sem termo técnico', () => {
    const unavailable = codeNotice({ kind: 'free', reason: 'unavailable' })
    const unrecognized = codeNotice({ kind: 'free', reason: 'unrecognized' })
    expect(unavailable).toBeTruthy()
    expect(unrecognized).toBeTruthy()
    for (const msg of [unavailable, unrecognized]) {
      expect(msg).not.toMatch(/gtin|sku|barra|barcode/i)
    }
  })

  it('estados não-free não têm aviso', () => {
    expect(codeNotice({ kind: 'idle' })).toBeNull()
    expect(codeNotice({ kind: 'filled', intrinsics, source: 'code', gtin14: null })).toBeNull()
    expect(codeNotice({ kind: 'contributing' })).toBeNull()
  })
})

describe('autocomplete por nome — client gate em lockstep com o engine (@cbrl/product)', () => {
  it('MIN_SEARCH_TERM_LENGTH iguala a constante do engine', () => {
    expect(MIN_SEARCH_TERM_LENGTH).toBe(ENGINE_MIN_SEARCH_TERM_LENGTH)
  })

  it('normalizeSearchTerm normaliza igual ao engine (trim/collapse/casefold)', () => {
    for (const raw of ['  Leite   Ninho  ', 'LEITE ninho', '   ', 'a  b', 'Café Torrado']) {
      expect(normalizeSearchTerm(raw)).toBe(engineNormalizeSearchTerm(raw))
    }
  })
})

describe('autocomplete por nome — suggestionFromResult (feature D, brief 0055)', () => {
  function resultFrom(gtin14: string, name: string, brand: string | null): NameSearchResult {
    const now = new Date()
    return {
      gtin14,
      product: {
        gtin14,
        name,
        brand,
        description: 'desc',
        photoUrl: 'http://x/p.png',
        measures: null,
        ncm: null,
        cest: null,
        utrib: null,
        category: null,
        source: 'official',
        createdAt: now,
        updatedAt: now,
      },
    }
  }

  it('mapeia o resultado da base pra sugestão em linguagem de produto', () => {
    const suggestion = suggestionFromResult(
      resultFrom('07891000100103', 'Leite Ninho 400g', 'Nestlé'),
    )
    expect(suggestion).toEqual({
      value: '07891000100103',
      name: 'Leite Ninho 400g',
      brand: 'Nestlé',
      intrinsics: {
        name: 'Leite Ninho 400g',
        brand: 'Nestlé',
        description: 'desc',
        photoUrl: 'http://x/p.png',
        measures: null,
      },
    })
  })

  it('value carrega o gtin14 (chave de referência, invisível na UX)', () => {
    const suggestion = suggestionFromResult(resultFrom('00036000291452', 'Café', null))
    expect(suggestion.value).toBe('00036000291452')
    expect(suggestion.brand).toBeNull()
  })
})

describe('autocomplete por nome — filledFromSuggestion + referenceGtinToWire', () => {
  const suggestion = {
    value: '07891000100103',
    name: 'Leite Ninho 400g',
    brand: 'Nestlé',
    intrinsics: {
      name: 'Leite Ninho 400g',
      brand: 'Nestlé',
      description: null,
      photoUrl: null,
      measures: null,
    },
  } as const

  it('escolher uma sugestão converge no MESMO filled (boca nome, com gtin14)', () => {
    expect(filledFromSuggestion(suggestion)).toEqual({
      kind: 'filled',
      intrinsics: suggestion.intrinsics,
      source: 'name',
      gtin14: '07891000100103',
    })
  })

  it('referenceGtinToWire devolve o gtin só pra boca nome', () => {
    expect(referenceGtinToWire(filledFromSuggestion(suggestion))).toBe('07891000100103')
  })

  it('referenceGtinToWire é null pra boca código (a chave fica no input de código)', () => {
    expect(
      referenceGtinToWire({
        kind: 'filled',
        intrinsics: suggestion.intrinsics,
        source: 'code',
        gtin14: null,
      }),
    ).toBeNull()
  })

  it('referenceGtinToWire é null fora do estado filled', () => {
    expect(referenceGtinToWire({ kind: 'idle' })).toBeNull()
    expect(referenceGtinToWire({ kind: 'contributing' })).toBeNull()
    expect(referenceGtinToWire({ kind: 'free', reason: 'unavailable' })).toBeNull()
  })
})
