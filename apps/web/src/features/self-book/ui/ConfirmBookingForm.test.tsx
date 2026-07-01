import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmBookingForm } from './ConfirmBookingForm'

const createWizardBooking = vi.fn()
const push = vi.fn()
const refresh = vi.fn()
const signOut = vi.fn()

vi.mock('@/features/self-book/adapters/wizard-book.actions', () => ({
  createWizardBooking: (fd: FormData): unknown => createWizardBooking(fd),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

vi.mock('@/shared/firebase/client', () => ({
  getClientAuth: () => ({}),
}))

vi.mock('firebase/auth', () => ({
  signOut: (auth: unknown): unknown => signOut(auth),
}))

const baseProps = {
  slug: 'acme',
  unitSlug: 'centro',
  serviceId: 's1',
  memberOperationId: 'p1',
  startAtIso: '2026-03-11T12:00:00.000Z',
  serviceLabel: 'Corte',
  memberOperationLabel: 'João',
  startAtLabel: 'qua, 11 de março, 09:00',
  cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
  changeSlotHref: '/acme/centro/availability?service=s1',
  unitWhatsapp: '5511999999999',
  unitName: 'Centro',
}

// Submit via the CTA's owning <form> (canonical repo pattern) so the React
// Server Action fires without driving Radix in jsdom.
function submitForm(): void {
  const submit = screen.getByRole('button', { name: /confirmar agendamento|entrar e confirmar/i })
  const form = submit instanceof HTMLButtonElement ? submit.form : null
  expect(form).not.toBeNull()
  fireEvent.submit(form ?? submit)
}

describe('ConfirmBookingForm — login gate (brief 0077 #1275)', () => {
  beforeEach(() => {
    createWizardBooking.mockReset()
    push.mockReset()
    refresh.mockReset()
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    )
  })

  it('carries NO customer PII inputs — name/whatsapp/email are removed', () => {
    render(<ConfirmBookingForm {...baseProps} viewerName={null} />)
    expect(screen.queryByLabelText(/seu nome/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/whatsapp/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/e-mail/i)).not.toBeInTheDocument()
  })

  it('greets a signed-in viewer by name and offers a one-click confirm', () => {
    render(<ConfirmBookingForm {...baseProps} viewerName="Maria Silva" />)
    expect(screen.getByText(/agendando como/i).textContent).toMatch(/Maria Silva/)
    expect(screen.getByRole('button', { name: /confirmar agendamento/i })).toBeInTheDocument()
  })

  it('prompts an anonymous viewer to enter to confirm', () => {
    render(<ConfirmBookingForm {...baseProps} viewerName={null} />)
    expect(screen.getByRole('button', { name: /entrar e confirmar/i })).toBeInTheDocument()
  })

  it('routes to /login?next=… on needs-login', async () => {
    createWizardBooking.mockResolvedValue({ ok: false, kind: 'needs-login' })
    render(<ConfirmBookingForm {...baseProps} viewerName={null} />)
    submitForm()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0]![0]).toMatch(/^\/login\?next=/)
  })

  it('routes to /onboarding/profile?next=… on needs-completion', async () => {
    createWizardBooking.mockResolvedValue({ ok: false, kind: 'needs-completion' })
    render(<ConfirmBookingForm {...baseProps} viewerName="Maria" />)
    submitForm()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0]![0]).toMatch(/^\/onboarding\/profile\?next=/)
  })

  // #1316 — a visitor on an inherited session can bail out of the wrong
  // identity: logout (session cookie + firebase) then back to /login with this
  // booking URL as `next` so re-auth resumes on the confirm step.
  it('offers "Trocar de conta" to a signed-in viewer and logs out to /login?next=', async () => {
    render(<ConfirmBookingForm {...baseProps} viewerName="Maria Silva" />)
    const link = screen.getByRole('button', { name: /não é você\? trocar de conta/i })
    fireEvent.click(link)
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledWith('/api/session', { method: 'DELETE' })
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0]![0]).toMatch(/^\/login\?next=/)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows no "Trocar de conta" affordance for an anonymous viewer', () => {
    render(<ConfirmBookingForm {...baseProps} viewerName={null} />)
    expect(screen.queryByRole('button', { name: /trocar de conta/i })).not.toBeInTheDocument()
  })

  it('navigates to success on a confirmed booking', async () => {
    createWizardBooking.mockResolvedValue({
      ok: true,
      bookingId: 'appt-9',
      orgId: 'o1',
      unitSlug: 'centro',
    })
    render(<ConfirmBookingForm {...baseProps} viewerName="Maria" />)
    submitForm()
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push.mock.calls[0]![0]).toBe('/acme/centro/book/success?appt=appt-9')
  })
})
