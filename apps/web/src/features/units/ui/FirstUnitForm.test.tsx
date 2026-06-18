import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FirstUnitForm } from './FirstUnitForm'

vi.mock('@/features/units/adapters/units.actions', () => ({
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
}))

vi.mock('@/hooks/use-cep-lookup', () => ({
  useCepLookup: () => ({ loading: false, data: null, error: null }),
}))

describe('FirstUnitForm — guided first unit (brief 0046, AC-03)', () => {
  it('prefills the unit name with the Negócio name', () => {
    render(<FirstUnitForm orgName="Barbearia do Bairro" />)
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Barbearia do Bairro')
  })

  it('collects the required fields (WhatsApp required, name required)', () => {
    render(<FirstUnitForm orgName="Salão X" />)
    const whatsapp = screen.getByLabelText(/whatsapp/i)
    expect(whatsapp).toHaveAttribute('name', 'whatsapp')
    expect(whatsapp).toBeRequired()
    expect(screen.getByLabelText(/nome/i)).toBeRequired()
  })

  it('seeds the default operating week (Mon–Sat enabled)', () => {
    render(<FirstUnitForm orgName="Salão X" />)
    // BusinessHoursFields renders a 09:00 open input for each enabled day; the
    // default week enables Mon–Sat, so at least one time input is present.
    const opens = screen.getAllByDisplayValue('09:00')
    expect(opens.length).toBeGreaterThan(0)
  })
})
