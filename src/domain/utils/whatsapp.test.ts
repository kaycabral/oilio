import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  renderWhatsappTemplate,
  resolveWhatsappTemplates,
} from './whatsapp'

describe('renderWhatsappTemplate', () => {
  it('replaces single placeholder', () => {
    expect(renderWhatsappTemplate('Oi {customerName}!', { customerName: 'Ana' })).toBe('Oi Ana!')
  })

  it('replaces multiple placeholders', () => {
    expect(
      renderWhatsappTemplate('{customerName} - {serviceName} às {time}', {
        customerName: 'João',
        serviceName: 'Corte',
        time: '10:00',
      }),
    ).toBe('João - Corte às 10:00')
  })

  it('drops missing keys (becomes empty string)', () => {
    expect(renderWhatsappTemplate('Oi {customerName} {missing}!', { customerName: 'Ana' })).toBe(
      'Oi Ana !',
    )
  })

  it('leaves unknown placeholder shape (no braces) untouched', () => {
    expect(renderWhatsappTemplate('No braces here', {})).toBe('No braces here')
  })
})

describe('resolveWhatsappTemplates', () => {
  it('returns all defaults when partial is null', () => {
    expect(resolveWhatsappTemplates(null)).toEqual(DEFAULT_WHATSAPP_TEMPLATES)
  })

  it('keeps custom values and fills missing ones', () => {
    const resolved = resolveWhatsappTemplates({ confirmation: 'meu template' })
    expect(resolved.confirmation).toBe('meu template')
    expect(resolved.reminder).toBe(DEFAULT_WHATSAPP_TEMPLATES.reminder)
    expect(resolved.cancellation).toBe(DEFAULT_WHATSAPP_TEMPLATES.cancellation)
  })

  it('treats empty/whitespace as missing on every field', () => {
    const resolved = resolveWhatsappTemplates({
      confirmation: '   ',
      reminder: '\t',
      cancellation: ' \n ',
    })
    expect(resolved).toEqual(DEFAULT_WHATSAPP_TEMPLATES)
  })

  it('returns all defaults for an empty object (no field present, no throw)', () => {
    expect(resolveWhatsappTemplates({})).toEqual(DEFAULT_WHATSAPP_TEMPLATES)
  })
})
