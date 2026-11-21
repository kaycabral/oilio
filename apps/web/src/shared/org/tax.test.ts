import { isCompany, normalizeTaxId, type TaxIdentity } from '@/domain'
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
    expect(normalizeTaxId('529.982.247-25')).toBe('52998224725')
    expect(normalizeTaxId('11.222.333/0001-81')).toBe('11222333000181')
  })
})
