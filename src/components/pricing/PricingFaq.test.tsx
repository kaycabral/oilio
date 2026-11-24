import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PricingFaq } from './PricingFaq'

describe('PricingFaq', () => {
  it('renders the frequently asked questions', () => {
    render(<PricingFaq />)
    expect(screen.getByRole('heading', { name: 'Perguntas frequentes' })).toBeInTheDocument()
    expect(screen.getByText(/como funciona a cobrança por unidade/i)).toBeInTheDocument()
    expect(screen.getByText(/qual a vantagem do plano anual/i)).toBeInTheDocument()
  })
})
