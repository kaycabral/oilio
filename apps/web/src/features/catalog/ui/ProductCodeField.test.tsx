import { clearedCodeState, type CodeFormState } from '@/features/catalog/core/catalog-item-form'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductCodeField } from './ProductCodeField'

function renderField(state: CodeFormState = clearedCodeState()) {
  const onLookup = vi.fn()
  const onCleared = vi.fn()
  render(
    <ProductCodeField
      defaultValue=""
      state={state}
      pending={false}
      onLookup={onLookup}
      onCleared={onCleared}
    />,
  )
  const input = screen.getByLabelText(/código do produto/i)
  return { input, onLookup, onCleared }
}

describe('ProductCodeField', () => {
  it('rende o campo com label humano e name=gtin, sem jargão técnico (AC-04)', () => {
    const { input } = renderField()
    expect(input).toHaveAttribute('name', 'gtin')
    expect(document.body.textContent ?? '').not.toMatch(/gtin|sku|código de barras|barcode/i)
  })

  it('Enter dispara o lookup com o código normalizado (autosubmit HID, AC-01)', () => {
    const { input, onLookup } = renderField()
    fireEvent.change(input, { target: { value: '789 1000-100103' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onLookup).toHaveBeenCalledWith('7891000100103')
  })

  it('blur dispara o lookup igual ao scan (colar/digitar, AC-05)', () => {
    const { input, onLookup } = renderField()
    fireEvent.change(input, { target: { value: '7891000100103' } })
    fireEvent.blur(input)
    expect(onLookup).toHaveBeenCalledWith('7891000100103')
  })

  it('esvaziar o campo reverte o estado (AC-06)', () => {
    const { input, onCleared, onLookup } = renderField()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onCleared).toHaveBeenCalled()
    expect(onLookup).not.toHaveBeenCalled()
  })

  it('no hit comunica que veio da base (AC-02)', () => {
    renderField({
      kind: 'filled',
      intrinsics: { name: 'Café', brand: null, description: null, photoUrl: null, measures: null },
      source: 'code',
      gtin14: null,
    })
    expect(screen.getByText(/veio preenchido da base/i)).toBeInTheDocument()
  })

  it('base indisponível mostra aviso leve sem jargão (AC-08)', () => {
    renderField({ kind: 'free', reason: 'unavailable' })
    const notice = screen.getByText(/não foi possível consultar a base/i)
    expect(notice).toBeInTheDocument()
    expect(notice.textContent ?? '').not.toMatch(/gtin|sku|barra/i)
  })
})
