import { describe, expect, it } from 'vitest'
import { deriveProfilePrefill, meetsMinAge, parseProfileForm } from './profile-form'

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
  const valid = { name: 'Joana', mobile: '+55 11 90000-0000', birthDate: '1990-05-05' }

  it('parses a valid form into a normalized payload', () => {
    const parsed = parseProfileForm(form(valid))
    expect(parsed).toMatchObject({ name: 'Joana', birthDate: '1990-05-05' })
    expect(typeof parsed === 'object' && parsed.mobile).toMatch(/^\+?55/)
  })

  it('rejects a short name', () => {
    expect(parseProfileForm(form({ ...valid, name: 'J' }))).toBe('Nome é obrigatório')
  })

  it('rejects an empty WhatsApp', () => {
    expect(parseProfileForm(form({ ...valid, mobile: '' }))).toBe('WhatsApp é obrigatório')
  })

  it('rejects an invalid WhatsApp', () => {
    expect(parseProfileForm(form({ ...valid, mobile: '123' }))).toBe('WhatsApp inválido')
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

describe('deriveProfilePrefill (progressive profiling — brief 0077 #1277)', () => {
  it('flags whatsapp + birthDate missing for a fresh Google sign-in', () => {
    const p = deriveProfilePrefill({
      name: 'Maria Silva',
      email: 'maria@gmail.com',
      mobile: null,
      birthDate: null,
    })
    expect(p.name).toBe('Maria Silva')
    expect(p.email).toBe('maria@gmail.com')
    expect(p.mobile).toBe('')
    expect(p.birthDate).toBe('')
    expect(p.missing).toEqual(['mobile', 'birthDate'])
  })

  it('reports nothing missing when every fact is on file', () => {
    const p = deriveProfilePrefill({
      name: 'Maria Silva',
      email: 'maria@gmail.com',
      mobile: '5511990000000',
      birthDate: '1990-05-05',
    })
    expect(p.missing).toEqual([])
  })

  it('treats a 1-char name as missing (parse requires ≥2)', () => {
    const p = deriveProfilePrefill({
      name: 'M',
      email: null,
      mobile: '5511990000000',
      birthDate: '1990-05-05',
    })
    expect(p.missing).toEqual(['name'])
    // The single char is still carried so the customer edits rather than retypes.
    expect(p.name).toBe('M')
  })

  it('trims whitespace and treats blank facts as missing', () => {
    const p = deriveProfilePrefill({ name: '  ', email: '  ', mobile: '   ', birthDate: '' })
    expect(p.name).toBe('')
    expect(p.email).toBe('')
    expect(p.missing).toEqual(['name', 'mobile', 'birthDate'])
  })
})
