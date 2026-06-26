import type { Category } from '@/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CatalogNameField,
  CategoryPicker,
  CommissionFieldset,
  VisibilityFieldset,
} from './CatalogItemFields'

describe('CatalogNameField', () => {
  it('idle: editável e required', () => {
    render(
      <CatalogNameField
        defaultName=""
        lockedValue={null}
        readOnly={false}
        required
        isContribution={false}
      />,
    )
    const name = screen.getByLabelText(/nome/i)
    expect(name).toHaveAttribute('name', 'name')
    expect(name).toBeRequired()
    expect(name).not.toHaveAttribute('readonly')
  })

  it('hit: preenchido da base e read-only (AC-02)', () => {
    render(
      <CatalogNameField
        defaultName=""
        lockedValue="Café torrado 500g"
        readOnly
        required={false}
        isContribution={false}
      />,
    )
    const name = screen.getByLabelText(/nome/i)
    expect(name).toHaveValue('Café torrado 500g')
    expect(name).toHaveAttribute('readonly')
  })

  it('miss: mostra a dica de contribuição (AC-03)', () => {
    render(
      <CatalogNameField
        defaultName=""
        lockedValue={null}
        readOnly={false}
        required
        isContribution
      />,
    )
    expect(screen.getByText(/dê um nome a este produto/i)).toBeInTheDocument()
  })

  it('preenchido por nome: oferece "Trocar produto" pra reverter (AC-06)', () => {
    const onClearFill = vi.fn()
    render(
      <CatalogNameField
        defaultName=""
        lockedValue="Leite Ninho 400g"
        readOnly
        required={false}
        isContribution={false}
        onClearFill={onClearFill}
      />,
    )
    const trocar = screen.getByRole('button', { name: /trocar produto/i })
    fireEvent.click(trocar)
    expect(onClearFill).toHaveBeenCalledTimes(1)
  })

  it('preenchido por código: NÃO mostra "Trocar produto" (revert é pelo campo de código)', () => {
    render(
      <CatalogNameField
        defaultName=""
        lockedValue="Leite Ninho 400g"
        readOnly
        required={false}
        isContribution={false}
      />,
    )
    expect(screen.queryByRole('button', { name: /trocar produto/i })).not.toBeInTheDocument()
  })
})

describe('CategoryPicker', () => {
  const categories: Category[] = [
    {
      id: 'c1',
      orgId: 't1',
      name: 'Bebidas',
      icon: null,
      color: null,
      active: true,
      archivedAt: null,
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    },
  ]

  it('mostra "Sem categoria" quando nenhuma está selecionada', () => {
    render(<CategoryPicker categories={categories} initialCategoryId={null} />)
    expect(screen.getByText(/sem categoria/i)).toBeInTheDocument()
  })

  it('pré-seleciona a categoria ao editar', () => {
    render(<CategoryPicker categories={categories} initialCategoryId="c1" />)
    expect(screen.getByText('Bebidas')).toBeInTheDocument()
  })

  it('avisa quando não há categorias', () => {
    render(<CategoryPicker categories={[]} initialCategoryId={null} />)
    expect(screen.getByText(/nenhuma categoria cadastrada/i)).toBeInTheDocument()
  })
})

describe('CommissionFieldset', () => {
  it('none por padrão esconde o campo de valor', () => {
    render(<CommissionFieldset commission={null} />)
    // The value input (labelled "Percentual (%)" / "Valor (R$)") is absent;
    // the radio options share the bare "Percentual"/"Valor fixo" labels.
    expect(screen.queryByLabelText(/percentual \(%\)|valor \(r\$\)/i)).not.toBeInTheDocument()
  })

  it('mostra o valor ao escolher percentual', () => {
    render(<CommissionFieldset commission={null} />)
    fireEvent.click(screen.getByLabelText(/percentual/i))
    expect(screen.getByLabelText(/percentual \(%\)/i)).toBeRequired()
  })

  it('pré-seleciona a comissão fixa existente', () => {
    render(<CommissionFieldset commission={{ kind: 'fixed', value: 1250 }} />)
    expect(screen.getByLabelText(/valor \(r\$\)/i)).toHaveValue('12,50')
  })
})

describe('VisibilityFieldset', () => {
  it('rende os três toggles com seus defaults', () => {
    render(
      <VisibilityFieldset
        activeLabel="Ativo (disponível para venda)"
        activeDefault
        publicVisibleDefault={false}
        priceOnRequestDefault={false}
      />,
    )
    expect(screen.getByText(/ativo \(disponível para venda\)/i)).toBeInTheDocument()
    expect(screen.getByText(/exibir no catálogo público/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/sob consulta/i)).toBeInTheDocument()
  })
})
