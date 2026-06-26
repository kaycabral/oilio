import { describe, expect, it } from 'vitest'

import { parseFormalizationFromForm } from './formalize'

const CNPJ = '40148980000199'

function profileFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taxId: CNPJ,
    isMei: false,
    taxRegime: 'simples_nacional',
    primaryActivity: { code: '6201501', description: 'Desenvolvimento de software' },
    secondaryActivities: [],
    companySize: 'micro',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    shareCapital: 1000,
    activityStartedAt: '2020-12-17',
    ...overrides,
  }
}

function formFor(
  fields: { taxId?: string; profile?: string; legalName?: string; tradeName?: string } = {},
): FormData {
  const fd = new FormData()
  fd.set('taxId', fields.taxId ?? '40.148.980/0001-99')
  fd.set('profile', fields.profile ?? JSON.stringify(profileFixture()))
  fd.set('legalName', fields.legalName ?? 'CABRAL TECNOLOGIA LTDA')
  if (fields.tradeName !== undefined) fd.set('tradeName', fields.tradeName)
  return fd
}

describe('parseFormalizationFromForm (brief 0048)', () => {
  it('parses a valid ATIVA formalization (masked CNPJ normalized)', () => {
    const result = parseFormalizationFromForm(formFor({ tradeName: 'CABRAL TECH' }))
    expect(typeof result).not.toBe('string')
    if (typeof result === 'string') throw new Error(result)
    expect(result.taxId).toBe(CNPJ)
    expect(result.companyProfile.taxId).toBe(CNPJ)
    expect(result.legalName).toBe('CABRAL TECNOLOGIA LTDA')
    expect(result.tradeName).toBe('CABRAL TECH')
  })

  it('treats an empty trade name as null', () => {
    const result = parseFormalizationFromForm(formFor({ tradeName: '' }))
    if (typeof result === 'string') throw new Error(result)
    expect(result.tradeName).toBeNull()
  })

  it('rejects an invalid CNPJ (not 14 digits)', () => {
    expect(parseFormalizationFromForm(formFor({ taxId: '123' }))).toBe('CNPJ deve ter 14 dígitos')
  })

  it('rejects when the profile field is missing', () => {
    const fd = formFor()
    fd.set('profile', '')
    expect(parseFormalizationFromForm(fd)).toBe('Consulte o CNPJ antes de confirmar')
  })

  it('rejects malformed profile JSON', () => {
    expect(parseFormalizationFromForm(formFor({ profile: '{not json' }))).toMatch(/inválidos/)
  })

  it('rejects a profile whose taxId disagrees with the submitted CNPJ', () => {
    const mismatched = JSON.stringify(profileFixture({ taxId: '11222333000181' }))
    expect(parseFormalizationFromForm(formFor({ profile: mismatched }))).toMatch(/inválidos/)
  })

  it('ATIVA gate: rejects a non-ATIVA registration status', () => {
    for (const status of ['BAIXADA', 'SUSPENSA', 'INAPTA']) {
      const profile = JSON.stringify(profileFixture({ registrationStatus: status }))
      expect(parseFormalizationFromForm(formFor({ profile }))).toMatch(/ATIVA/)
    }
  })

  it('rejects when the looked-up razão social is missing', () => {
    expect(parseFormalizationFromForm(formFor({ legalName: '' }))).toMatch(/Razão social/)
  })
})
