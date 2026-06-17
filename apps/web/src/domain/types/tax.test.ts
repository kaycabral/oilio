import { describe, expect, it } from 'vitest'
import {
  isCompany,
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
