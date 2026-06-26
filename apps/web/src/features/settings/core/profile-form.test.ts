import { describe, expect, it } from 'vitest'
import {
  changedProfileFields,
  meetsMinAge,
  parseProfileForm,
  type ProfileFormPayload,
} from './profile-form'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const VALID = {
  name: 'Maria Silva',
  whatsapp: '+55 11 90000-0000',
  birthDate: '1990-01-01',
}

describe('parseProfileForm', () => {
  it('parses a valid form into a typed payload', () => {
    const payload = parseProfileForm(form(VALID))
    expect(typeof payload).not.toBe('string')
    if (typeof payload === 'string') throw new Error(`expected a parsed profile, got: ${payload}`)
    expect(payload.name).toBe('Maria Silva')
    expect(payload.birthDate).toBe('1990-01-01')
    expect(payload.whatsapp.length).toBeGreaterThan(0)
  })

  it('rejects a short name', () => {
    expect(parseProfileForm(form({ ...VALID, name: 'M' }))).toBe('Nome é obrigatório')
  })

  it('rejects an empty whatsapp', () => {
    expect(parseProfileForm(form({ ...VALID, whatsapp: '' }))).toBe('WhatsApp é obrigatório')
  })

  it('rejects an invalid whatsapp', () => {
    expect(parseProfileForm(form({ ...VALID, whatsapp: '123' }))).toBe('WhatsApp inválido')
  })

  it('rejects a missing birth date', () => {
    expect(parseProfileForm(form({ ...VALID, birthDate: '' }))).toBe(
      'Data de nascimento é obrigatória',
    )
  })

  it('rejects a subject under the minimum age', () => {
    const tooYoung = new Date()
    const isoYear = tooYoung.getFullYear() - 5
    const birthDate = `${isoYear}-01-01`
    expect(parseProfileForm(form({ ...VALID, birthDate }))).toBe('Idade mínima 13 anos')
  })
})

describe('meetsMinAge', () => {
  // Local-time constructor so getFullYear/getMonth/getDate are tz-stable.
  const today = new Date(2026, 5, 12)

  it('accepts a birth date older than the cutoff', () => {
    expect(meetsMinAge('2000-06-12', 13, today)).toBe(true)
  })

  it('rejects a birth date younger than the cutoff', () => {
    expect(meetsMinAge('2020-06-12', 13, today)).toBe(false)
  })

  it('accepts exactly the cutoff birthday', () => {
    expect(meetsMinAge('2013-06-12', 13, today)).toBe(true)
  })
})

describe('changedProfileFields', () => {
  const payload: ProfileFormPayload = {
    name: 'Maria',
    whatsapp: '5511999999999',
    birthDate: '1990-01-01',
  }

  it('reports only the fields that differ', () => {
    expect(
      changedProfileFields(payload, {
        displayName: 'Joana',
        whatsapp: '5511999999999',
        birthDate: '1990-01-01',
      }),
    ).toEqual(['displayName'])
  })

  it('reports all fields when current is empty', () => {
    expect(changedProfileFields(payload, {})).toEqual(['displayName', 'whatsapp', 'birthDate'])
  })

  it('reports nothing when identical', () => {
    expect(
      changedProfileFields(payload, {
        displayName: 'Maria',
        whatsapp: '5511999999999',
        birthDate: '1990-01-01',
      }),
    ).toEqual([])
  })
})
