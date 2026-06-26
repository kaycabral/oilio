import { CATEGORY_NAME_MAX } from '@/domain'
import { describe, expect, it } from 'vitest'
import { parseCategoryForm } from './category-form'

function fd(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

describe('parseCategoryForm', () => {
  it('parses a valid category', () => {
    expect(
      parseCategoryForm(fd({ name: 'Cabelo', icon: 'scissors', color: '#f00', active: 'on' })),
    ).toEqual({ name: 'Cabelo', icon: 'scissors', color: '#f00', active: true })
  })

  it('trims the name and nulls empty icon/color', () => {
    expect(parseCategoryForm(fd({ name: '  Unha  ' }))).toEqual({
      name: 'Unha',
      icon: null,
      color: null,
      active: false,
    })
  })

  it('treats active only as "on"', () => {
    const r = parseCategoryForm(fd({ name: 'Estética', active: 'true' }))
    expect(r).toMatchObject({ active: false })
  })

  it('rejects a too-short name', () => {
    expect(parseCategoryForm(fd({ name: 'a' }))).toBe('Nome é obrigatório')
  })

  it('rejects a missing name', () => {
    expect(parseCategoryForm(fd({}))).toBe('Nome é obrigatório')
  })

  it('rejects a too-long name', () => {
    const long = 'x'.repeat(CATEGORY_NAME_MAX + 1)
    expect(parseCategoryForm(fd({ name: long }))).toBe(
      `Nome muito longo (máx. ${CATEGORY_NAME_MAX})`,
    )
  })
})
