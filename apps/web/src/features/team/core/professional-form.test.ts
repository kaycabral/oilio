import { describe, expect, it } from 'vitest'
import { parseProfessionalForm, type ProfessionalPayload } from './professional-form'

// Builds a FormData; array values are appended (so getAll works).
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x))
    else fd.set(k, v)
  }
  return fd
}

// Narrows `ProfessionalPayload | string` without a cast: a rejection returns an
// error string, so a successful parse is "not a string".
function asPayload(r: ProfessionalPayload | string): ProfessionalPayload {
  if (typeof r === 'string') throw new Error(`expected a parsed professional, got: ${r}`)
  return r
}

describe('parseProfessionalForm', () => {
  it('parses a minimal valid form (no tax, no commission)', () => {
    expect(parseProfessionalForm(form({ unitIds: ['u1', 'u2'] }))).toEqual({
      taxIdentity: null,
      defaultCommission: null,
      unitIds: ['u1', 'u2'],
      serviceIds: [],
    })
  })

  it('dedups unit + service ids and drops empties', () => {
    const r = asPayload(
      parseProfessionalForm(
        form({ unitIds: ['u1', 'u1', '', 'u2'], serviceIds: ['s1', 's1', ''] }),
      ),
    )
    expect(r.unitIds).toEqual(['u1', 'u2'])
    expect(r.serviceIds).toEqual(['s1'])
  })

  it('parses a percentage commission as-is', () => {
    const r = asPayload(
      parseProfessionalForm(
        form({ unitIds: ['u1'], commissionKind: 'percentage', commissionValue: '40' }),
      ),
    )
    expect(r.defaultCommission).toEqual({ kind: 'percentage', value: 40 })
  })

  it('parses a fixed commission to cents (comma decimal accepted)', () => {
    const r = asPayload(
      parseProfessionalForm(
        form({ unitIds: ['u1'], commissionKind: 'fixed', commissionValue: '12,50' }),
      ),
    )
    expect(r.defaultCommission).toEqual({ kind: 'fixed', value: 1250 })
  })

  it('rejects a negative/NaN commission value', () => {
    expect(
      parseProfessionalForm(
        form({ unitIds: ['u1'], commissionKind: 'fixed', commissionValue: '-1' }),
      ),
    ).toBe('Valor de comissão inválido')
  })

  it('requires at least one unit', () => {
    expect(parseProfessionalForm(form({ unitIds: [] }))).toBe(
      'Profissional precisa estar vinculado a pelo menos 1 unidade',
    )
  })

  it('propagates a tax-identity error', () => {
    expect(
      parseProfessionalForm(form({ unitIds: ['u1'], taxKind: 'individual', taxId: '123' })),
    ).toBe('CPF deve ter 11 dígitos')
  })
})
