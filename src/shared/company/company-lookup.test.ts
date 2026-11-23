import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { BrasilApiCnpjResponse, normalizeCompanyLookup } from './company-lookup'

const decode = Schema.decodeUnknownSync(BrasilApiCnpjResponse)

describe('normalizeCompanyLookup', () => {
  it('maps the real CABRAL TECNOLOGIA payload (Simples, micro, ATIVA)', () => {
    const raw = decode({
      cnpj: '40148980000199',
      razao_social: 'CABRAL TECNOLOGIA LTDA',
      nome_fantasia: 'CABRAL TECNOLOGIA',
      descricao_situacao_cadastral: 'ATIVA',
      opcao_pelo_simples: true,
      opcao_pelo_mei: false,
      codigo_porte: 1,
      cnae_fiscal: 6201501,
      cnae_fiscal_descricao: 'Desenvolvimento de programas de computador sob encomenda',
      cnaes_secundarios: [{ codigo: 6202300, descricao: 'Desenvolvimento customizável' }],
      natureza_juridica: 'Sociedade Empresária Limitada',
      capital_social: 1000,
      data_inicio_atividade: '2020-12-17',
    })

    const result = normalizeCompanyLookup(raw, '40148980000199')

    expect(result.legalName).toBe('CABRAL TECNOLOGIA LTDA')
    expect(result.tradeName).toBe('CABRAL TECNOLOGIA')
    expect(result.profile).toEqual({
      taxId: '40148980000199',
      isMei: false,
      taxRegime: 'simples_nacional',
      primaryActivity: {
        code: '6201501',
        description: 'Desenvolvimento de programas de computador sob encomenda',
      },
      secondaryActivities: [{ code: '6202300', description: 'Desenvolvimento customizável' }],
      companySize: 'micro',
      legalNature: 'Sociedade Empresária Limitada',
      registrationStatus: 'ATIVA',
      shareCapital: 1000,
      activityStartedAt: '2020-12-17',
    })
  })

  it('flags MEI and derives the mei regime', () => {
    const raw = decode({
      razao_social: 'JOAO DA SILVA 12345678900',
      opcao_pelo_simples: true,
      opcao_pelo_mei: true,
      codigo_porte: 1,
    })
    const result = normalizeCompanyLookup(raw, '11111111000111')
    expect(result.profile.isMei).toBe(true)
    expect(result.profile.taxRegime).toBe('mei')
  })

  it('degrades a partial response to safe defaults (no throw)', () => {
    const raw = decode({})
    const result = normalizeCompanyLookup(raw, '22222222000122')
    expect(result.legalName).toBe('')
    expect(result.tradeName).toBeNull()
    expect(result.profile.taxRegime).toBe('other')
    expect(result.profile.companySize).toBe('other')
    expect(result.profile.shareCapital).toBe(0)
    expect(result.profile.secondaryActivities).toEqual([])
  })

  it('coerces a string capital_social and empties a blank trade name', () => {
    const raw = decode({ nome_fantasia: '   ', capital_social: '50000' })
    const result = normalizeCompanyLookup(raw, '33333333000133')
    expect(result.profile.shareCapital).toBe(50000)
    expect(result.tradeName).toBeNull()
  })
})
