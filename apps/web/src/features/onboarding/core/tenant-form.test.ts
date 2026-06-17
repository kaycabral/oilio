import { describe, expect, it } from 'vitest'
import { parseTenantForm } from './tenant-form'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('parseTenantForm', () => {
  it('parses a valid name + vertical', () => {
    expect(parseTenantForm(form({ name: 'Barbearia do Bairro', vertical: 'barbershop' }))).toEqual({
      name: 'Barbearia do Bairro',
      vertical: 'barbershop',
    })
  })

  it('trims the name', () => {
    const parsed = parseTenantForm(form({ name: '  Salão  ', vertical: 'other' }))
    expect(parsed).toEqual({ name: 'Salão', vertical: 'other' })
  })

  it('rejects a short name', () => {
    expect(parseTenantForm(form({ name: 'A', vertical: 'barbershop' }))).toBe('Name is too short')
  })

  it('rejects an unknown vertical', () => {
    expect(parseTenantForm(form({ name: 'Salão', vertical: 'spaceship' }))).toBe('Invalid vertical')
  })

  it('rejects a missing vertical', () => {
    expect(parseTenantForm(form({ name: 'Salão' }))).toBe('Invalid vertical')
  })
})
