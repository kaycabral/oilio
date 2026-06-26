import { describe, expect, it } from 'vitest'
import { parseCreateForm } from './subscription-form'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const VALID = {
  customerId: 'cust-1',
  planId: 'plan-1',
  billingCycle: 'monthly',
  startAt: '2026-06-15',
}

describe('parseCreateForm', () => {
  it('parses a valid form, normalizing startAt to UTC midnight', () => {
    expect(parseCreateForm(form(VALID))).toEqual({
      customerId: 'cust-1',
      planId: 'plan-1',
      billingCycle: 'monthly',
      startAt: '2026-06-15T00:00:00.000Z',
      displayedPriceCents: null,
    })
  })

  it('threads an optional displayed price', () => {
    const r = parseCreateForm(form({ ...VALID, displayedPriceCents: '9000' }))
    if (typeof r === 'string') throw new Error(`expected a parsed subscription, got: ${r}`)
    expect(r.displayedPriceCents).toBe(9000)
  })

  it.each([
    ['customerId', { customerId: '' }, 'Cliente é obrigatório'],
    ['planId', { planId: '' }, 'Plano é obrigatório'],
    ['billingCycle', { billingCycle: 'weekly' }, 'Ciclo de cobrança inválido'],
    ['startAt format', { startAt: '15/06/2026' }, 'Data de início inválida'],
    ['displayed price negative', { displayedPriceCents: '-1' }, 'Preço exibido inválido'],
    ['displayed price non-integer', { displayedPriceCents: '1.5' }, 'Preço exibido inválido'],
  ])('rejects bad %s', (_label, override, message) => {
    expect(parseCreateForm(form({ ...VALID, ...override }))).toBe(message)
  })
})
