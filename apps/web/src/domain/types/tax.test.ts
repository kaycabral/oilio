import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  CompanyProfile,
  FiscalProfile,
  INFORMAL_FISCAL_PROFILE,
  deriveCompanySize,
  deriveTaxRegime,
  formatCnpj,
  isActiveRegistrationStatus,
  isCompany,
  isCompanyFiscalProfile,
  isValidCompanyTaxId,
  isValidIndividualTaxId,
  normalizeTaxId,
  type TaxIdentity,
} from './tax'

describe('isCompany', () => {
  it('narrows on kind', () => {
    expect(isCompany({ kind: 'company', taxId: '1', legalName: 'X' })).toBe(true)
    expect(isCompany({ kind: 'individual', taxId: '1' } satisfies TaxIdentity)).toBe(false)
  })
})

describe('normalizeTaxId', () => {
  it('strips every non-digit character', () => {
    expect(normalizeTaxId('123.456.789-00')).toBe('12345678900')
    expect(normalizeTaxId('12.345.678/0001-99')).toBe('12345678000199')
  })
  it('keeps digits, drops letters/spaces, empties a digit-less string', () => {
    expect(normalizeTaxId(' a1b2c3 ')).toBe('123')
    expect(normalizeTaxId('abc')).toBe('')
    expect(normalizeTaxId('')).toBe('')
  })
})

describe('isValidIndividualTaxId (CPF — 11 digits)', () => {
  it('accepts exactly 11 digits (formatted or raw)', () => {
    expect(isValidIndividualTaxId('123.456.789-00')).toBe(true)
    expect(isValidIndividualTaxId('12345678900')).toBe(true)
  })
  it('rejects 10 or 12 digits (length boundary)', () => {
    expect(isValidIndividualTaxId('1234567890')).toBe(false)
    expect(isValidIndividualTaxId('123456789012')).toBe(false)
  })
  it('rejects a value with no digits', () => {
    expect(isValidIndividualTaxId('not-a-number')).toBe(false)
  })
})

describe('isValidCompanyTaxId (CNPJ — 14 digits)', () => {
  it('accepts exactly 14 digits (formatted or raw)', () => {
    expect(isValidCompanyTaxId('12.345.678/0001-99')).toBe(true)
    expect(isValidCompanyTaxId('12345678000199')).toBe(true)
  })
  it('rejects 13 or 15 digits (length boundary)', () => {
    expect(isValidCompanyTaxId('1234567800019')).toBe(false)
    expect(isValidCompanyTaxId('123456780001999')).toBe(false)
  })
  it('rejects an 11-digit CPF', () => {
    expect(isValidCompanyTaxId('12345678900')).toBe(false)
  })
})

describe('isCompany (with optional tradeName)', () => {
  it('narrows a company that carries a trade name', () => {
    const t: TaxIdentity = {
      kind: 'company',
      taxId: '12345678000199',
      legalName: 'CABRAL TECNOLOGIA LTDA',
      tradeName: 'CABRAL TECNOLOGIA',
    }
    expect(isCompany(t)).toBe(true)
  })
  it('accepts a company with no trade name', () => {
    expect(isCompany({ kind: 'company', taxId: '1', legalName: 'X', tradeName: null })).toBe(true)
  })
})

describe('deriveTaxRegime', () => {
  it('MEI wins over Simples (more specific truth)', () => {
    expect(deriveTaxRegime(true, true)).toBe('mei')
    expect(deriveTaxRegime(false, true)).toBe('mei')
  })
  it('Simples when opted in and not MEI', () => {
    expect(deriveTaxRegime(true, false)).toBe('simples_nacional')
  })
  it('other when neither flag is set (regime_tributario array is unreliable)', () => {
    expect(deriveTaxRegime(false, false)).toBe('other')
  })
})

describe('deriveCompanySize', () => {
  it('maps the Receita codigo_porte buckets', () => {
    expect(deriveCompanySize(1)).toBe('micro')
    expect(deriveCompanySize(3)).toBe('small')
    expect(deriveCompanySize(5)).toBe('other')
  })
  it('falls back to other for unknown codes', () => {
    expect(deriveCompanySize(0)).toBe('other')
  })
})

describe('CompanyProfile (decode)', () => {
  const decode = Schema.decodeUnknownSync(CompanyProfile)
  it('decodes a full corporate profile (CABRAL TECNOLOGIA fixture)', () => {
    const profile = decode({
      taxId: '40148980000199',
      isMei: false,
      taxRegime: 'simples_nacional',
      primaryActivity: {
        code: '6201501',
        description: 'Desenvolvimento de programas sob encomenda',
      },
      secondaryActivities: [{ code: '6202300', description: 'Desenvolvimento customizável' }],
      companySize: 'micro',
      legalNature: 'Sociedade Empresária Limitada',
      registrationStatus: 'ATIVA',
      shareCapital: 1000,
      activityStartedAt: '2020-12-17',
    })
    expect(profile.taxRegime).toBe('simples_nacional')
    expect(profile.primaryActivity.code).toBe('6201501')
    expect(profile.secondaryActivities).toHaveLength(1)
  })
  it('rejects an out-of-enum tax regime', () => {
    expect(() =>
      decode({
        taxId: '1',
        isMei: false,
        taxRegime: 'lucro_real',
        primaryActivity: { code: '1', description: 'x' },
        secondaryActivities: [],
        companySize: 'micro',
        legalNature: 'x',
        registrationStatus: 'ATIVA',
        shareCapital: 0,
        activityStartedAt: '2020-01-01',
      }),
    ).toThrow()
  })
})

describe('formatCnpj (brief 0048 AC-07)', () => {
  it('masks a full CNPJ to 00.000.000/0000-00', () => {
    expect(formatCnpj('40148980000199')).toBe('40.148.980/0001-99')
  })

  it('strips non-digits and caps at 14 digits', () => {
    expect(formatCnpj('40.148.980/0001-99extra')).toBe('40.148.980/0001-99')
  })

  it('masks progressively for partial input', () => {
    expect(formatCnpj('40')).toBe('40')
    expect(formatCnpj('401')).toBe('40.1')
    expect(formatCnpj('40148980')).toBe('40.148.980')
    expect(formatCnpj('401489800001')).toBe('40.148.980/0001')
  })

  it('returns empty for empty input', () => {
    expect(formatCnpj('')).toBe('')
  })
})

describe('isActiveRegistrationStatus (ATIVA gate, brief 0048 AC-05)', () => {
  it('accepts ATIVA case-insensitively with surrounding space', () => {
    expect(isActiveRegistrationStatus('ATIVA')).toBe(true)
    expect(isActiveRegistrationStatus('ativa')).toBe(true)
    expect(isActiveRegistrationStatus(' Ativa ')).toBe(true)
  })

  it('rejects every non-ATIVA status', () => {
    expect(isActiveRegistrationStatus('BAIXADA')).toBe(false)
    expect(isActiveRegistrationStatus('SUSPENSA')).toBe(false)
    expect(isActiveRegistrationStatus('INAPTA')).toBe(false)
    expect(isActiveRegistrationStatus('')).toBe(false)
  })
})

describe('FiscalProfile (brief 0048 AC-01)', () => {
  const decode = Schema.decodeUnknownSync(FiscalProfile)

  it('the informal default narrows as informal', () => {
    expect(INFORMAL_FISCAL_PROFILE).toEqual({ stage: 'informal' })
    expect(isCompanyFiscalProfile(INFORMAL_FISCAL_PROFILE)).toBe(false)
  })

  it('narrows the company variant', () => {
    const company: FiscalProfile = {
      stage: 'company',
      taxId: '40148980000199',
      companyProfile: {
        taxId: '40148980000199',
        isMei: false,
        taxRegime: 'simples_nacional',
        primaryActivity: { code: '6201501', description: 'Desenvolvimento de software' },
        secondaryActivities: [],
        companySize: 'micro',
        legalNature: '2062',
        registrationStatus: 'ATIVA',
        shareCapital: 1000,
        activityStartedAt: '2020-01-01',
      },
      formalizedAt: '2026-06-18T00:00:00.000Z',
    }
    expect(isCompanyFiscalProfile(company)).toBe(true)
    expect(decode(company)).toEqual(company)
  })

  it('rejects a company variant missing the required corporate fields', () => {
    expect(() => decode({ stage: 'company', taxId: '40148980000199' })).toThrow()
  })

  it('rejects an unknown stage', () => {
    expect(() => decode({ stage: 'partial' })).toThrow()
  })
})
