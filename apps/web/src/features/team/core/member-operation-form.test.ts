import { describe, expect, it } from 'vitest'
import { parseMemberOperationForm, type MemberOperationPayload } from './member-operation-form'

// Builds a FormData; array values are appended (so getAll works).
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x))
    else fd.set(k, v)
  }
  return fd
}

// Narrows `MemberOperationPayload | string` without a cast: a rejection returns an
// error string, so a successful parse is "not a string".
function asPayload(r: MemberOperationPayload | string): MemberOperationPayload {
  if (typeof r === 'string') throw new Error(`expected a parsed memberOperation, got: ${r}`)
  return r
}

describe('parseMemberOperationForm', () => {
  it('parses a minimal valid form (no tax, no commission)', () => {
    expect(parseMemberOperationForm(form({ unitIds: ['u1', 'u2'] }))).toEqual({
      taxIdentity: null,
      defaultCommission: null,
      unitIds: ['u1', 'u2'],
      catalogServiceIds: [],
    })
  })

  it('dedups unit + service ids and drops empties', () => {
    const r = asPayload(
      parseMemberOperationForm(
        form({ unitIds: ['u1', 'u1', '', 'u2'], catalogServiceIds: ['s1', 's1', ''] }),
      ),
    )
    expect(r.unitIds).toEqual(['u1', 'u2'])
    expect(r.catalogServiceIds).toEqual(['s1'])
  })

  it('parses a percentage commission as-is', () => {
    const r = asPayload(
      parseMemberOperationForm(
        form({ unitIds: ['u1'], commissionKind: 'percentage', commissionValue: '40' }),
      ),
    )
    expect(r.defaultCommission).toEqual({ kind: 'percentage', value: 40 })
  })

  it('parses a fixed commission to cents (comma decimal accepted)', () => {
    const r = asPayload(
      parseMemberOperationForm(
        form({ unitIds: ['u1'], commissionKind: 'fixed', commissionValue: '12,50' }),
      ),
    )
    expect(r.defaultCommission).toEqual({ kind: 'fixed', value: 1250 })
  })

  it('rejects a negative/NaN commission value', () => {
    expect(
      parseMemberOperationForm(
        form({ unitIds: ['u1'], commissionKind: 'fixed', commissionValue: '-1' }),
      ),
    ).toBe('Valor de comissão inválido')
  })

  it('requires at least one unit', () => {
    expect(parseMemberOperationForm(form({ unitIds: [] }))).toBe(
      'Profissional precisa estar vinculado a pelo menos 1 unidade',
    )
  })

  it('propagates a tax-identity error', () => {
    expect(
      parseMemberOperationForm(form({ unitIds: ['u1'], taxKind: 'individual', taxId: '123' })),
    ).toBe('CPF deve ter 11 dígitos')
  })
})
