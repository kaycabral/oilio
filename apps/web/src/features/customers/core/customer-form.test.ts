import { describe, expect, it } from 'vitest'
import { parseCustomerForm } from './customer-form'

function fd(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

describe('parseCustomerForm', () => {
  it('parses a valid customer', () => {
    expect(
      parseCustomerForm(fd({ name: 'Ana', whatsapp: '11999990000', email: 'a@b.com' })),
    ).toEqual({
      name: 'Ana',
      whatsapp: '11999990000',
      email: 'a@b.com',
      birthDate: null,
    })
  })

  it('trims and nulls an empty email', () => {
    const r = parseCustomerForm(fd({ name: '  Bia  ', whatsapp: '11', email: '   ' }))
    expect(r).toMatchObject({ name: 'Bia', email: null })
  })

  it('rejects a too-short name', () => {
    expect(parseCustomerForm(fd({ name: 'A', whatsapp: '11' }))).toBe('Nome é obrigatório')
  })

  it('rejects a missing whatsapp', () => {
    expect(parseCustomerForm(fd({ name: 'Ana', whatsapp: '' }))).toBe('WhatsApp é obrigatório')
  })
})
