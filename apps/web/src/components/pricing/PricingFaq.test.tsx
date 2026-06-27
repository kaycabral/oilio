import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PricingFaq } from './PricingFaq'

describe('PricingFaq', () => {
  it('renders the frequently asked questions', () => {
    render(<PricingFaq />)
    expect(screen.getByRole('heading', { name: 'Perguntas frequentes' })).toBeInTheDocument()
    expect(screen.getByText(/quem pode criar uma conta no oilio/i)).toBeInTheDocument()
    expect(screen.getByText(/os preços já são definitivos/i)).toBeInTheDocument()
  })
})
