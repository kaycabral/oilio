import { describe, expect, it } from 'vitest'
import { isValidTimezone } from './timezone'
import { UF_TO_TZ, inferTimezoneFromAddress, resolveTenantTimezoneFromAddress } from './timezone-br'

describe('UF_TO_TZ', () => {
  it('covers all 27 Brazilian UFs (26 states + DF)', () => {
    const expected = [
      'AC',
      'AL',
      'AM',
      'AP',
      'BA',
      'CE',
      'DF',
      'ES',
      'GO',
      'MA',
      'MG',
      'MS',
      'MT',
      'PA',
      'PB',
      'PE',
      'PI',
      'PR',
      'RJ',
      'RN',
      'RO',
      'RR',
      'RS',
      'SC',
      'SE',
      'SP',
      'TO',
    ]
    expect(Object.keys(UF_TO_TZ).sort()).toEqual(expected.sort())
  })

  it('maps every UF to a valid IANA timezone', () => {
    for (const [uf, tz] of Object.entries(UF_TO_TZ)) {
      expect(isValidTimezone(tz), `${uf} → ${tz}`).toBe(true)
    }
  })
})

describe('inferTimezoneFromAddress', () => {
  it('returns America/Sao_Paulo for SP/RJ/MG/DF', () => {
    expect(inferTimezoneFromAddress('SP', 'São Paulo')).toBe('America/Sao_Paulo')
    expect(inferTimezoneFromAddress('RJ', 'Rio de Janeiro')).toBe('America/Sao_Paulo')
    expect(inferTimezoneFromAddress('MG', 'Belo Horizonte')).toBe('America/Sao_Paulo')
    expect(inferTimezoneFromAddress('DF', 'Brasília')).toBe('America/Sao_Paulo')
  })

  it('returns America/Manaus for AM (eastern Amazonas)', () => {
    expect(inferTimezoneFromAddress('AM', 'Manaus')).toBe('America/Manaus')
    expect(inferTimezoneFromAddress('AM', 'Parintins')).toBe('America/Manaus')
  })

  it('returns America/Eirunepe for western Amazonas municipalities', () => {
    expect(inferTimezoneFromAddress('AM', 'Eirunepé')).toBe('America/Eirunepe')
    expect(inferTimezoneFromAddress('AM', 'Benjamin Constant')).toBe('America/Eirunepe')
    expect(inferTimezoneFromAddress('AM', 'Tabatinga')).toBe('America/Eirunepe')
    expect(inferTimezoneFromAddress('AM', 'Atalaia do Norte')).toBe('America/Eirunepe')
  })

  it('returns America/Rio_Branco for AC', () => {
    expect(inferTimezoneFromAddress('AC', 'Rio Branco')).toBe('America/Rio_Branco')
  })

  it('returns America/Cuiaba for MT', () => {
    expect(inferTimezoneFromAddress('MT', 'Cuiabá')).toBe('America/Cuiaba')
  })

  it('returns America/Campo_Grande for MS', () => {
    expect(inferTimezoneFromAddress('MS', 'Campo Grande')).toBe('America/Campo_Grande')
  })

  it('returns America/Belem for PA', () => {
    expect(inferTimezoneFromAddress('PA', 'Belém')).toBe('America/Belem')
  })

  it('returns America/Recife for PE continental', () => {
    expect(inferTimezoneFromAddress('PE', 'Recife')).toBe('America/Recife')
    expect(inferTimezoneFromAddress('PE', 'Olinda')).toBe('America/Recife')
  })

  it('returns America/Noronha for Fernando de Noronha (PE)', () => {
    expect(inferTimezoneFromAddress('PE', 'Fernando de Noronha')).toBe('America/Noronha')
  })

  it('normalizes accents and casing on city name', () => {
    expect(inferTimezoneFromAddress('AM', 'EIRUNEPÉ')).toBe('America/Eirunepe')
    expect(inferTimezoneFromAddress('AM', 'eirunepé  ')).toBe('America/Eirunepe')
    expect(inferTimezoneFromAddress('PE', 'FERNANDO DE NORONHA')).toBe('America/Noronha')
  })

  it('normalizes UF casing and whitespace', () => {
    expect(inferTimezoneFromAddress(' sp ', 'São Paulo')).toBe('America/Sao_Paulo')
    expect(inferTimezoneFromAddress('mt', 'Cuiabá')).toBe('America/Cuiaba')
  })

  it('falls back to America/Sao_Paulo for unknown UF', () => {
    expect(inferTimezoneFromAddress('XX', 'Wherever')).toBe('America/Sao_Paulo')
    expect(inferTimezoneFromAddress('', '')).toBe('America/Sao_Paulo')
  })
})

describe('resolveTenantTimezoneFromAddress', () => {
  it('returns the inferred tz when tenant has default and inferred differs', () => {
    expect(resolveTenantTimezoneFromAddress('America/Sao_Paulo', 'AM', 'Manaus')).toBe(
      'America/Manaus',
    )
    expect(resolveTenantTimezoneFromAddress('America/Sao_Paulo', 'AC', 'Rio Branco')).toBe(
      'America/Rio_Branco',
    )
    expect(resolveTenantTimezoneFromAddress('America/Sao_Paulo', 'PE', 'Fernando de Noronha')).toBe(
      'America/Noronha',
    )
  })

  it('returns null when tenant has default and inferred matches default', () => {
    expect(resolveTenantTimezoneFromAddress('America/Sao_Paulo', 'SP', 'São Paulo')).toBe(null)
    expect(resolveTenantTimezoneFromAddress('America/Sao_Paulo', 'RJ', 'Rio')).toBe(null)
  })

  it('returns null when tenant already has a non-default tz (never overrides owner choice)', () => {
    expect(resolveTenantTimezoneFromAddress('America/Manaus', 'AM', 'Manaus')).toBe(null)
    expect(resolveTenantTimezoneFromAddress('America/Manaus', 'SP', 'São Paulo')).toBe(null)
    expect(resolveTenantTimezoneFromAddress('UTC', 'AC', 'Rio Branco')).toBe(null)
  })
})
