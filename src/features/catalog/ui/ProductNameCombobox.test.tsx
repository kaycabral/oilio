import type { ProductSuggestion } from '@/features/catalog/core/catalog-item-form'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductNameCombobox } from './ProductNameCombobox'

const SUGGESTIONS: ProductSuggestion[] = [
  {
    value: '07891000100103',
    name: 'Leite Ninho 400g',
    brand: 'Nestlé',
    intrinsics: {
      name: 'Leite Ninho 400g',
      brand: 'Nestlé',
      description: null,
      photoUrl: null,
      measures: null,
    },
  },
  {
    value: '07891000100110',
    name: 'Leite Ninho 800g',
    brand: 'Nestlé',
    intrinsics: {
      name: 'Leite Ninho 800g',
      brand: 'Nestlé',
      description: null,
      photoUrl: null,
      measures: null,
    },
  },
]

function renderCombobox(opts: { suggestions?: ProductSuggestion[]; searching?: boolean } = {}) {
  const onQuery = vi.fn()
  const onSelect = vi.fn()
  const onCleared = vi.fn()
  const onDismiss = vi.fn()
  render(
    <ProductNameCombobox
      defaultName=""
      required
      suggestions={opts.suggestions ?? []}
      searching={opts.searching ?? false}
      onQuery={onQuery}
      onSelect={onSelect}
      onCleared={onCleared}
      onDismiss={onDismiss}
    />,
  )
  const input = screen.getByRole('combobox')
  return { input, onQuery, onSelect, onCleared, onDismiss }
}

describe('ProductNameCombobox', () => {
  it('rende o input de nome como combobox, sem jargão técnico (AC-07)', () => {
    const { input } = renderCombobox()
    expect(input).toHaveAttribute('name', 'name')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(document.body.textContent ?? '').not.toMatch(/gtin|sku|código de barras|barcode|código/i)
  })

  it('digitar dispara a busca com o termo (a shell faz o debounce, AC-01)', () => {
    const { input, onQuery } = renderCombobox()
    fireEvent.change(input, { target: { value: 'ninho' } })
    expect(onQuery).toHaveBeenCalledWith('ninho')
  })

  it('esvaziar o campo reverte o estado (AC-06)', () => {
    const { input, onQuery, onCleared } = renderCombobox()
    fireEvent.change(input, { target: { value: '   ' } })
    expect(onCleared).toHaveBeenCalled()
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('mostra as sugestões inline (nome + marca) ao focar', () => {
    const { input } = renderCombobox({ suggestions: SUGGESTIONS })
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('Leite Ninho 400g')).toBeInTheDocument()
    expect(screen.getAllByText('Nestlé').length).toBeGreaterThan(0)
  })

  it('escolher uma sugestão (clique) chama onSelect (AC-02)', () => {
    const { input, onSelect } = renderCombobox({ suggestions: SUGGESTIONS })
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByText('Leite Ninho 400g'))
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0])
  })

  it('navega com ↓ e escolhe com Enter (teclado)', () => {
    const { input, onSelect } = renderCombobox({ suggestions: SUGGESTIONS })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1])
  })

  it('reseta o índice ativo quando a lista encolhe (sem highlight órfão)', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <ProductNameCombobox
        defaultName=""
        required
        suggestions={SUGGESTIONS}
        searching={false}
        onQuery={vi.fn()}
        onSelect={onSelect}
        onCleared={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    rerender(
      <ProductNameCombobox
        defaultName=""
        required
        suggestions={[SUGGESTIONS[0]!]}
        searching={false}
        onQuery={vi.fn()}
        onSelect={onSelect}
        onCleared={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('Esc fecha a lista sem escolher e aborta a busca pendente', () => {
    const { input, onSelect, onDismiss } = renderCombobox({ suggestions: SUGGESTIONS })
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalled()
  })

  it('blur fecha a lista e aborta a busca SINCRONAMENTE (sem timer diferido)', () => {
    const { input, onDismiss } = renderCombobox({ suggestions: SUGGESTIONS })
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('mostra o indicador de carregamento enquanto busca', () => {
    renderCombobox({ searching: true })
    expect(screen.getByText(/buscando/i)).toBeInTheDocument()
  })

  it('sem sugestões não rende a lista (zero resultado → input normal, AC-04)', () => {
    const { input } = renderCombobox({ suggestions: [] })
    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
