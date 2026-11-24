import { describe, expect, it } from 'vitest'
import { parseOrgForm } from './org-form'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('parseOrgForm', () => {
  it('parses a valid name + vertical', () => {
    expect(parseOrgForm(form({ name: 'Barbearia do Bairro', vertical: 'barbershop' }))).toEqual({
      name: 'Barbearia do Bairro',
      vertical: 'barbershop',
    })
  })

  it('trims the name', () => {
    const parsed = parseOrgForm(form({ name: '  Salão  ', vertical: 'other' }))
    expect(parsed).toEqual({ name: 'Salão', vertical: 'other' })
  })

  it('rejects a short name', () => {
    expect(parseOrgForm(form({ name: 'A', vertical: 'barbershop' }))).toBe('Name is too short')
  })

  it('rejects an unknown vertical', () => {
    expect(parseOrgForm(form({ name: 'Salão', vertical: 'spaceship' }))).toBe('Invalid vertical')
  })

  it('rejects a missing vertical', () => {
    expect(parseOrgForm(form({ name: 'Salão' }))).toBe('Invalid vertical')
  })
})
