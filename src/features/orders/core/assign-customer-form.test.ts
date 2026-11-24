import { describe, expect, it } from 'vitest'
import { parseAssignCustomerForm } from './assign-customer-form'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe('parseAssignCustomerForm', () => {
  it('existing: default mode picks a customer by id', () => {
    expect(parseAssignCustomerForm(fd({ customerId: 'c1' }))).toEqual({
      mode: 'existing',
      customerId: 'c1',
    })
  })

  it('existing: empty customerId is rejected', () => {
    expect(parseAssignCustomerForm(fd({ customerMode: 'existing', customerId: '  ' }))).toBe(
      'Cliente é obrigatório',
    )
  })

  it('new: registers a customer inline (name + whatsapp)', () => {
    expect(
      parseAssignCustomerForm(
        fd({ customerMode: 'new', newCustomerName: 'João', newCustomerMobile: '11999998888' }),
      ),
    ).toEqual({ mode: 'new', newCustomer: { name: 'João', mobile: '11999998888' } })
  })

  it('new: name shorter than 2 chars is rejected', () => {
    expect(
      parseAssignCustomerForm(
        fd({ customerMode: 'new', newCustomerName: 'A', newCustomerMobile: '1' }),
      ),
    ).toBe('Nome do cliente é obrigatório')
  })

  it('new: missing whatsapp is rejected', () => {
    expect(
      parseAssignCustomerForm(
        fd({ customerMode: 'new', newCustomerName: 'João', newCustomerMobile: '' }),
      ),
    ).toBe('WhatsApp do cliente é obrigatório')
  })

  it('none: unlinks (no customer fields needed)', () => {
    expect(parseAssignCustomerForm(fd({ customerMode: 'none' }))).toEqual({ mode: 'none' })
  })
})
