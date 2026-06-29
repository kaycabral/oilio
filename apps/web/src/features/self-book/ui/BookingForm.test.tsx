import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingForm } from './BookingForm'

const createPublicBooking = vi.fn()
const push = vi.fn()

vi.mock('@/features/self-book/adapters/book.actions', () => ({
  createPublicBooking: (fd: FormData): unknown => createPublicBooking(fd),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
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

describe('BookingForm — login gate (brief 0077 #1275)', () => {
  beforeEach(() => {
    createPublicBooking.mockReset()
    push.mockReset()
  })

  const baseProps = {
    slug: 'acme',
    services,
    memberOperations,
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
  }

  // React Server Action forms only run their action on a valid submit. The
  // service/pro selects are `required`; rather than drive Radix comboboxes in
  // jsdom, submit the <form> directly so the action handler fires. The action
  // itself is mocked — these specs exercise the client routing branches.
  function submitForm(): void {
    const submit = screen.getByRole('button', { name: /entrar e agendar/i })
    const form = submit instanceof HTMLButtonElement ? submit.form : null
    expect(form).not.toBeNull()
    fireEvent.submit(form ?? submit)
  }

  it('carries NO customer PII inputs — name/whatsapp/email are removed', () => {
    render(<BookingForm {...baseProps} />)
    expect(screen.queryByLabelText(/seu nome/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/whatsapp/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/e-mail/i)).not.toBeInTheDocument()
    // The CTA reflects the login-first flow.
    expect(screen.getByRole('button', { name: /entrar e agendar/i })).toBeInTheDocument()
  })

  it('routes to /login?next=… when the action signals needs-login', async () => {
    createPublicBooking.mockResolvedValue({ ok: false, kind: 'needs-login' })
    render(<BookingForm {...baseProps} />)
    submitForm()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0]![0]).toMatch(/^\/login\?next=/)
  })

  it('routes to /onboarding/profile?next=… when the action signals needs-completion', async () => {
    createPublicBooking.mockResolvedValue({ ok: false, kind: 'needs-completion' })
    render(<BookingForm {...baseProps} />)
    submitForm()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0]![0]).toMatch(/^\/onboarding\/profile\?next=/)
  })

  it('shows the confirmation panel on success', async () => {
    createPublicBooking.mockResolvedValue({ ok: true, bookingId: 'appt-123456789', orgId: 'o1' })
    render(<BookingForm {...baseProps} />)
    submitForm()
    expect(await screen.findByText(/agendamento confirmado/i)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
