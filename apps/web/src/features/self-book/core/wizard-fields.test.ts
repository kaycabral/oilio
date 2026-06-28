import { describe, expect, it } from 'vitest'
import { parseWizardFields } from './wizard-fields'

const NOW = Date.parse('2026-03-10T12:00:00.000Z')
const FUTURE = '2026-03-11T12:00:00.000Z'

function form(overrides: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    serviceId: 's1',
    memberOperationId: 'p1',
    startAt: FUTURE,
    customerName: 'Maria Silva',
    customerWhatsapp: '(11) 99999-9999',
    customerEmail: 'maria@example.com',
    ...overrides,
  }
  const fd = new FormData()
  for (const [k, v] of Object.entries(base)) fd.set(k, v)
  return fd
}

describe('parseWizardFields', () => {
  it('parses a complete valid form', () => {
    const result = parseWizardFields(form(), NOW)
    expect(typeof result).not.toBe('string')
    if (typeof result === 'string') throw new Error(result)
    expect(result.serviceId).toBe('s1')
    expect(result.memberOperationId).toBe('p1')
    expect(result.customerName).toBe('Maria Silva')
    expect(result.whatsapp).toBe('5511999999999')
    expect(result.startAtDate.toISOString()).toBe(FUTURE)
    expect(result.customerEmailRaw).toBe('maria@example.com')
  })

  it('rejects missing service', () => {
    expect(parseWizardFields(form({ serviceId: '' }), NOW)).toBe('Serviço não selecionado.')
  })

  it('rejects missing memberOperation', () => {
    expect(parseWizardFields(form({ memberOperationId: '' }), NOW)).toBe(
      'Profissional não selecionado.',
    )
  })

  it('rejects missing start', () => {
    expect(parseWizardFields(form({ startAt: '' }), NOW)).toBe('Horário não selecionado.')
  })

  it('rejects a too-short name', () => {
    expect(parseWizardFields(form({ customerName: 'A' }), NOW)).toBe('Informe seu nome completo.')
  })

  it('rejects an invalid whatsapp', () => {
    expect(parseWizardFields(form({ customerWhatsapp: '123' }), NOW)).toBe(
      'Número de WhatsApp inválido.',
    )
  })

  it('rejects a non-parseable start', () => {
    expect(parseWizardFields(form({ startAt: 'not-a-date' }), NOW)).toBe('Horário inválido.')
  })

  it('rejects a past start', () => {
    expect(parseWizardFields(form({ startAt: '2026-03-09T12:00:00.000Z' }), NOW)).toBe(
      'Esse horário já passou.',
    )
  })
})
