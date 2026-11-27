import { describe, expect, it } from 'vitest'
import { formCents, parseCentsInput } from './form-data'

describe('parseCentsInput', () => {
  it('parses pt-BR amounts, thousands included, to integer cents', () => {
    expect(parseCentsInput('1.234,56')).toBe(123456)
    expect(parseCentsInput('1.234')).toBe(123400)
    expect(parseCentsInput('1234,56')).toBe(123456)
    expect(parseCentsInput('1234.56')).toBe(123456)
    expect(parseCentsInput('R$ 80,00')).toBe(8000)
  })

  it('treats a blank field as zero', () => {
    expect(parseCentsInput('')).toBe(0)
    expect(parseCentsInput('   ')).toBe(0)
  })

  it('rejects negative and non-numeric input', () => {
    expect(parseCentsInput('-5')).toBeNull()
    expect(parseCentsInput('abc')).toBeNull()
  })

  it('round-trips the input formatter output', async () => {
    const { formatAmountFromCents } = await import('@cbrl/br/money')
    for (const cents of [0, 5, 8000, 123456, 99999999]) {
      expect(parseCentsInput(formatAmountFromCents(cents))).toBe(cents)
    }
  })
})

describe('formCents', () => {
  it('reads a form field as cents', () => {
    const fd = new FormData()
    fd.set('price', '2.500,00')
    expect(formCents(fd, 'price')).toBe(250000)
    expect(formCents(fd, 'missing')).toBe(0)
  })
})
