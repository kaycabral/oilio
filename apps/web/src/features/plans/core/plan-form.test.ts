import { describe, expect, it } from 'vitest'
import { findDanglingCoverageRef, parseAllowedTimeScope, parsePlanForm } from './plan-form'

// Helper pra montar FormData minimalista pros casos.
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

describe('parseAllowedTimeScope — error branches (4 casos)', () => {
  it('AC-05 — rejeita restrictDaysOfWeek=on com daysOfWeek vazio', () => {
    const result = parseAllowedTimeScope(makeForm({ restrictDaysOfWeek: 'on' }))
    expect(result).toBe('Selecione ao menos um dia da semana ou desmarque a restrição')
  })

  it('AC-05 — rejeita hourRange com HH:mm inválido', () => {
    const result = parseAllowedTimeScope(
      makeForm({
        restrictHourRange: 'on',
        hourRangeStart: '8:00',
        hourRangeEnd: '18:00',
      }),
    )
    expect(result).toBe('Faixa horária inválida (use HH:mm)')
  })

  it('AC-05 — rejeita hourRange invertido (start >= end)', () => {
    const result = parseAllowedTimeScope(
      makeForm({
        restrictHourRange: 'on',
        hourRangeStart: '18:00',
        hourRangeEnd: '08:00',
      }),
    )
    expect(result).toBe('A hora de início deve ser menor que a hora de término')
  })

  it('AC-05 — rejeita advanceBookingDays <= 0', () => {
    const result = parseAllowedTimeScope(
      makeForm({ restrictAdvance: 'on', advanceBookingDays: '0' }),
    )
    expect(result).toBe('Janela de antecedência deve ser maior que zero')
  })
})

describe('parseAllowedTimeScope — happy paths', () => {
  it('retorna undefined quando todas as toggles estão off', () => {
    expect(parseAllowedTimeScope(makeForm({}))).toBeUndefined()
  })

  it('retorna scope completo quando 3 toggles ativos com valores válidos', () => {
    const result = parseAllowedTimeScope(
      makeForm({
        restrictDaysOfWeek: 'on',
        daysOfWeek: ['1', '2', '3', '4', '5'],
        restrictHourRange: 'on',
        hourRangeStart: '08:00',
        hourRangeEnd: '18:00',
        restrictAdvance: 'on',
        advanceBookingDays: '3',
      }),
    )
    expect(result).toEqual({
      daysOfWeek: [1, 2, 3, 4, 5],
      hourRange: { start: '08:00', end: '18:00' },
      advanceBookingDays: 3,
    })
  })

  it('deduplicia + ordena daysOfWeek', () => {
    const result = parseAllowedTimeScope(
      makeForm({
        restrictDaysOfWeek: 'on',
        daysOfWeek: ['3', '1', '2', '1', '3'],
      }),
    )
    expect(result).toEqual({ daysOfWeek: [1, 2, 3] })
  })
})

describe('findDanglingCoverageRef — coverage integrity (brief 0024, AC-03)', () => {
  const items = new Set(['svc-corte', 'prod-pomada'])
  const cats = new Set(['cat-cabelo'])

  it('retorna null quando todos os refs existem (item + categoria)', () => {
    expect(findDanglingCoverageRef(['svc-corte', 'prod-pomada'], ['cat-cabelo'], items, cats)).toBe(
      null,
    )
  })

  it('retorna null para cobertura vazia', () => {
    expect(findDanglingCoverageRef([], [], items, cats)).toBe(null)
  })

  it('detecta item de catálogo inexistente', () => {
    expect(findDanglingCoverageRef(['svc-fantasma'], [], items, cats)).toBe(
      'Item de catálogo inexistente na cobertura: svc-fantasma',
    )
  })

  it('detecta categoria inexistente', () => {
    expect(findDanglingCoverageRef([], ['cat-fantasma'], items, cats)).toBe(
      'Categoria inexistente na cobertura: cat-fantasma',
    )
  })

  it('reporta o primeiro ref pendente (item antes de categoria)', () => {
    expect(findDanglingCoverageRef(['svc-x'], ['cat-y'], items, cats)).toBe(
      'Item de catálogo inexistente na cobertura: svc-x',
    )
  })
})

describe('parsePlanForm', () => {
  function validBase(): Record<string, string | string[]> {
    return {
      name: 'Plano Mensal',
      priceCents: '99,90',
      billingCycle: 'monthly',
      limitKind: 'unlimited',
    }
  }

  it('rejeita nome curto', () => {
    expect(parsePlanForm(makeForm({ ...validBase(), name: 'x' }))).toBe('Nome é obrigatório')
  })

  it('rejeita ciclo de cobrança inválido', () => {
    expect(parsePlanForm(makeForm({ ...validBase(), billingCycle: 'weekly' }))).toBe(
      'Ciclo de cobrança inválido',
    )
  })

  it('rejeita tipo de limite inválido', () => {
    expect(parsePlanForm(makeForm({ ...validBase(), limitKind: 'bogus' }))).toBe(
      'Tipo de limite inválido',
    )
  })

  it('converte preço em reais para centavos e dedupe coverage', () => {
    const result = parsePlanForm(
      makeForm({
        ...validBase(),
        includedItemIds: ['svc-a', 'svc-a', 'svc-b'],
        active: 'on',
      }),
    )
    expect(result).toMatchObject({
      name: 'Plano Mensal',
      priceCents: 9990,
      billingCycle: 'monthly',
      includedItemIds: ['svc-a', 'svc-b'],
      usageLimit: { kind: 'unlimited' },
      active: true,
    })
  })
})
