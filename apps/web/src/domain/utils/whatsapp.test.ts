import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  buildWhatsappLink,
  formatBrazilPhone,
  maskBrazilPhone,
  normalizeBrazilPhone,
  renderWhatsappTemplate,
  resolveWhatsappTemplates,
} from './whatsapp'

describe('normalizeBrazilPhone', () => {
  it('strips formatting and prepends 55 for 11-digit mobile', () => {
    expect(normalizeBrazilPhone('(11) 91234-5678')).toBe('5511912345678')
  })

  it('prepends 55 for 10-digit landline', () => {
    expect(normalizeBrazilPhone('1112345678')).toBe('551112345678')
  })

  it('preserves 12 or 13 digit numbers (already with country code)', () => {
    expect(normalizeBrazilPhone('5511912345678')).toBe('5511912345678')
    expect(normalizeBrazilPhone('551112345678')).toBe('551112345678')
  })

  it('returns null for empty or non-numeric input', () => {
    expect(normalizeBrazilPhone('')).toBeNull()
    expect(normalizeBrazilPhone('---')).toBeNull()
  })

  it('returns null for clearly too-short input', () => {
    expect(normalizeBrazilPhone('12345')).toBeNull()
  })

  it('keeps a 12-digit number (already with country code)', () => {
    // '447911123456' is 12 digits → the explicit 12/13 branch.
    expect(normalizeBrazilPhone('+44 7911 123456')).toBe('447911123456')
  })

  it('keeps 14- and 15-digit numbers via the >=11 && <=15 E.164 fallback', () => {
    // Not 10/11/12/13 → exercises the generic length-11..15 branch.
    expect(normalizeBrazilPhone('12345678901234')).toBe('12345678901234')
    expect(normalizeBrazilPhone('123456789012345')).toBe('123456789012345')
  })

  it('returns null past the E.164 max of 15 digits', () => {
    expect(normalizeBrazilPhone('1234567890123456')).toBeNull()
  })
})

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

describe('formatBrazilPhone', () => {
  it('formats mobile and landline, stripping the 55 country code', () => {
    expect(formatBrazilPhone('5511970000002')).toBe('(11) 97000-0002')
    expect(formatBrazilPhone('+55 11 97000-0002')).toBe('(11) 97000-0002')
    expect(formatBrazilPhone('1133334444')).toBe('(11) 3333-4444')
  })

  it('returns the input unchanged when it cannot be formatted', () => {
    expect(formatBrazilPhone('123')).toBe('123')
  })
})

describe('maskBrazilPhone', () => {
  it('progressively masks as digits are typed', () => {
    expect(maskBrazilPhone('')).toBe('')
    expect(maskBrazilPhone('11')).toBe('(11')
    expect(maskBrazilPhone('1199700')).toBe('(11) 9970-0')
    expect(maskBrazilPhone('11997000002')).toBe('(11) 99700-0002')
  })

  it('ignores non-digits and caps at 11 digits', () => {
    expect(maskBrazilPhone('(11) 99700-0002 extra')).toBe('(11) 99700-0002')
  })
})
