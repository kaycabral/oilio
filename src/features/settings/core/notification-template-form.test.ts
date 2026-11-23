import { describe, expect, it } from 'vitest'
import { parseTemplateForm, type TemplateFormPayload } from './notification-template-form'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('parseTemplateForm', () => {
  it('parses a valid form, reading enabled from presence of the field', () => {
    const r = parseTemplateForm(form({ type: 'birthday', body: '  Olá!  ', enabled: 'on' }))
    expect(r).toEqual<TemplateFormPayload>({ type: 'birthday', body: 'Olá!', enabled: true })
  })

  it('treats a missing enabled field as disabled', () => {
    const r = parseTemplateForm(form({ type: 'birthday', body: 'Olá!' }))
    if (typeof r === 'string') throw new Error(`expected a parsed template, got: ${r}`)
    expect(r.enabled).toBe(false)
  })

  it('rejects an invalid notification type', () => {
    expect(parseTemplateForm(form({ type: 'nope', body: 'x' }))).toBe(
      'Tipo de notificação inválido',
    )
  })

  it('rejects an empty body', () => {
    expect(parseTemplateForm(form({ type: 'birthday', body: '   ' }))).toBe(
      'A mensagem não pode ficar vazia',
    )
  })
})
