import { describe, expect, it } from 'vitest'
import { meetsMinAge, parseProfileForm } from './profile-form'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('meetsMinAge', () => {
  const today = new Date(2026, 5, 12)

  it('accepts someone exactly at the threshold', () => {
    expect(meetsMinAge('2013-06-12', 13, today)).toBe(true)
  })

  it('accepts someone older', () => {
    expect(meetsMinAge('2000-01-01', 13, today)).toBe(true)
  })

  it('rejects someone younger', () => {
    expect(meetsMinAge('2013-06-13', 13, today)).toBe(false)
    expect(meetsMinAge('2020-01-01', 13, today)).toBe(false)
  })
})

describe('parseProfileForm', () => {
  const valid = { name: 'Joana', whatsapp: '+55 11 90000-0000', birthDate: '1990-05-05' }

  it('parses a valid form into a normalized payload', () => {
    const parsed = parseProfileForm(form(valid))
    expect(parsed).toMatchObject({ name: 'Joana', birthDate: '1990-05-05' })
    expect(typeof parsed === 'object' && parsed.whatsapp).toMatch(/^\+?55/)
  })

  it('rejects a short name', () => {
    expect(parseProfileForm(form({ ...valid, name: 'J' }))).toBe('Nome é obrigatório')
  })

  it('rejects an empty WhatsApp', () => {
    expect(parseProfileForm(form({ ...valid, whatsapp: '' }))).toBe('WhatsApp é obrigatório')
  })

  it('rejects an invalid WhatsApp', () => {
    expect(parseProfileForm(form({ ...valid, whatsapp: '123' }))).toBe('WhatsApp inválido')
  })

  it('rejects a missing birthDate', () => {
    expect(parseProfileForm(form({ ...valid, birthDate: '' }))).toBe(
      'Data de nascimento é obrigatória',
    )
  })

  it('rejects an underage birthDate', () => {
    const recent = new Date().getFullYear() - 5
    expect(parseProfileForm(form({ ...valid, birthDate: `${recent}-01-01` }))).toBe(
      'Idade mínima 13 anos',
    )
  })
})
