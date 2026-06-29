import { describe, expect, it } from 'vitest'
import { parseWizardFields } from './wizard-fields'

const NOW = Date.parse('2026-03-10T12:00:00.000Z')
const FUTURE = '2026-03-11T12:00:00.000Z'

// Since brief 0077 (#1275) the confirm step carries NO customer PII — login is
// required and the Customer is derived from the authenticated uid — so the
// parser only validates the booking coordinates (service/pro/startAt).
function form(overrides: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    serviceId: 's1',
    memberOperationId: 'p1',
    startAt: FUTURE,
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
    expect(result.startAtDate.toISOString()).toBe(FUTURE)
  })

  it('does not parse any customer PII (none is carried anymore)', () => {
    // Even if a tampered form smuggles PII fields, the parser ignores them —
    // the typed result has only the booking coordinates.
    const result = parseWizardFields(
      form({ customerName: 'Maria', customerWhatsapp: '11999999999' }),
      NOW,
    )
    if (typeof result === 'string') throw new Error(result)
    expect(Object.keys(result).sort()).toEqual(['memberOperationId', 'serviceId', 'startAtDate'])
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

  it('rejects a non-parseable start', () => {
    expect(parseWizardFields(form({ startAt: 'not-a-date' }), NOW)).toBe('Horário inválido.')
  })

  it('rejects a past start', () => {
    expect(parseWizardFields(form({ startAt: '2026-03-09T12:00:00.000Z' }), NOW)).toBe(
      'Esse horário já passou.',
    )
  })
})
