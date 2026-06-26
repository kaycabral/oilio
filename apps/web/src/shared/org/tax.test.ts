import {
  isCompany,
  isValidCompanyTaxId,
  isValidIndividualTaxId,
  normalizeTaxId,
  type TaxIdentity,
} from '@/domain'
import { describe, expect, it } from 'vitest'

describe('TaxIdentity', () => {
  it('isCompany narrows the type', () => {
    const t: TaxIdentity = { kind: 'company', taxId: '11222333000181', legalName: 'ACME LTDA' }
    expect(isCompany(t)).toBe(true)
    if (isCompany(t)) {
      expect(t.legalName).toBe('ACME LTDA')
    }
  })

  it('normalizeTaxId strips non-digits', () => {
    expect(normalizeTaxId('111.222.333-44')).toBe('11122233344')
    expect(normalizeTaxId('11.222.333/0001-81')).toBe('11222333000181')
  })

  it('isValidIndividualTaxId requires 11 digits', () => {
    expect(isValidIndividualTaxId('111.222.333-44')).toBe(true)
    expect(isValidIndividualTaxId('111')).toBe(false)
    expect(isValidIndividualTaxId('11222333000181')).toBe(false)
  })

  it('isValidCompanyTaxId requires 14 digits', () => {
    expect(isValidCompanyTaxId('11.222.333/0001-81')).toBe(true)
    expect(isValidCompanyTaxId('11122233344')).toBe(false)
  })
})
