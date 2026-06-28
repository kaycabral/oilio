import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BookingForm } from './BookingForm'

vi.mock('@/features/self-book/adapters/book.actions', () => ({
  createPublicBooking: vi.fn(),
}))

const services = [{ id: 's1', name: 'Corte', durationMinutes: 30, priceCents: 5000 }]
const memberOperations = [{ id: 'p1', name: 'João', unitName: 'Centro' }]

describe('BookingForm — cancellation policy notice (#871)', () => {
  it('does not render the notice when policy is disabled', () => {
    render(
      <BookingForm
        slug="acme"
        services={services}
        memberOperations={memberOperations}
        cancellationPolicy={{ enabled: false, minNoticeMinutes: 120 }}
      />,
    )
    expect(
      screen.queryByText(/Você pode cancelar a qualquer momento pelo app/i),
    ).not.toBeInTheDocument()
  })

  it('renders the notice with the configured window when enabled', () => {
    render(
      <BookingForm
        slug="acme"
        services={services}
        memberOperations={memberOperations}
        cancellationPolicy={{ enabled: true, minNoticeMinutes: 120 }}
      />,
    )
    const notice = screen.getByText(/Você pode cancelar a qualquer momento pelo app/i)
    expect(notice).toBeInTheDocument()
    expect(notice.textContent).toMatch(/2 horas/i)
  })

  it('formats sub-hour windows in minutes', () => {
    render(
      <BookingForm
        slug="acme"
        services={services}
        memberOperations={memberOperations}
        cancellationPolicy={{ enabled: true, minNoticeMinutes: 45 }}
      />,
    )
    expect(screen.getByText(/Você pode cancelar a qualquer momento pelo app/i).textContent).toMatch(
      /45 minutos/i,
    )
  })

  it('formats multi-day windows in days when divisible', () => {
    render(
      <BookingForm
        slug="acme"
        services={services}
        memberOperations={memberOperations}
        cancellationPolicy={{ enabled: true, minNoticeMinutes: 60 * 24 * 2 }}
      />,
    )
    expect(screen.getByText(/Você pode cancelar a qualquer momento pelo app/i).textContent).toMatch(
      /2 dias/i,
    )
  })
})
