import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  buildWhatsappLink,
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

describe('buildWhatsappLink', () => {
  it('builds a wa.me link with URL-encoded message', () => {
    const link = buildWhatsappLink('(11) 91234-5678', 'Oi! Tudo bem?')
    expect(link).toBe('https://wa.me/5511912345678?text=Oi!%20Tudo%20bem%3F')
  })

  it('returns null when phone is invalid', () => {
    expect(buildWhatsappLink('', 'Oi')).toBeNull()
    expect(buildWhatsappLink('abc', 'Oi')).toBeNull()
  })

  it('preserves newlines via encoding', () => {
    const link = buildWhatsappLink('11912345678', 'Linha 1\nLinha 2')
    expect(link).toContain('Linha%201%0ALinha%202')
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
    // Each `partial?.x?.trim()` must short-circuit when the key is absent.
    expect(resolveWhatsappTemplates({})).toEqual(DEFAULT_WHATSAPP_TEMPLATES)
  })
})
