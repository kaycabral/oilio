import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CheckoutResult = { ok: false; error: string } | { ok: true }

const mocks = vi.hoisted(() => ({
  startCheckout: vi.fn<(form: FormData) => Promise<CheckoutResult>>(() =>
    Promise.resolve({ ok: false, error: 'x' }),
  ),
  manageBilling: vi.fn<() => Promise<CheckoutResult>>(() =>
    Promise.resolve({ ok: false, error: 'x' }),
  ),
  cancelSubscription: vi.fn<() => Promise<CheckoutResult>>(() => Promise.resolve({ ok: true })),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/features/billing/adapters/checkout.actions', () => ({
  startCheckout: mocks.startCheckout,
  manageBilling: mocks.manageBilling,
}))
vi.mock('@/features/billing/adapters/cancel.actions', () => ({
  cancelSubscription: mocks.cancelSubscription,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }))

import { BillingPanel } from './BillingPanel'

type Props = React.ComponentProps<typeof BillingPanel>

function props(over: Partial<Props> = {}): Props {
  return {
    tier: 'advanced',
    status: 'active',
    billingCycle: 'monthly',
    unitQuantity: 3,
    unitCount: 3,
    orgName: 'Barbearia do Zé',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    hasStripeCustomer: true,
    canManageBilling: true,
    paymentMethod: { brand: 'mastercard', last4: '6717', expMonth: 8, expYear: 2028 },
    invoices: [
      {
        id: 'in_1',
        date: '2026-06-18T00:00:00.000Z',
        amount: 24750,
        currency: 'brl',
        status: 'paid',
        hostedUrl: 'https://stripe.test/in_1',
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BillingPanel — plan card', () => {
  it('shows the tier name and the localized status badge', () => {
    render(<BillingPanel {...props({ tier: 'pro', status: 'past_due' })} />)
    expect(screen.getByText('Plano Pro')).toBeInTheDocument()
    expect(screen.getByText('Pagamento pendente')).toBeInTheDocument()
  })

  it('falls back to the raw status when unmapped', () => {
    render(<BillingPanel {...props({ status: 'weird_state' })} />)
    expect(screen.getByText('weird_state')).toBeInTheDocument()
  })

  it('renders the context line with org name, units and renewal date', () => {
    render(<BillingPanel {...props({ unitCount: 2 })} />)
    expect(
      screen.getByText(/Barbearia do Zé · 2 unidades · renova em/, { exact: false }),
    ).toBeInTheDocument()
  })

  it('shows the cancel-at-period-end badge and an "acesso até" context', () => {
    render(<BillingPanel {...props({ cancelAtPeriodEnd: true })} />)
    expect(screen.getByText('Cancela no fim do ciclo')).toBeInTheDocument()
    expect(screen.getByText(/acesso até/, { exact: false })).toBeInTheDocument()
  })

  it('notes the billed quantity when it differs from the live unit count', () => {
    render(<BillingPanel {...props({ unitCount: 5, unitQuantity: 4 })} />)
    expect(screen.getByText(/Stripe cobra 4 unidades/, { exact: false })).toBeInTheDocument()
  })
})

describe('BillingPanel — Free plan', () => {
  it('shows the subscribe CTA and no plan card / payment / invoices', () => {
    render(
      <BillingPanel
        {...props({
          tier: 'free',
          status: 'active',
          billingCycle: null,
          currentPeriodEnd: null,
          hasStripeCustomer: false,
          paymentMethod: null,
          invoices: [],
        })}
      />,
    )
    expect(screen.getByText('Assinar um plano')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assinar o Pro' })).toBeInTheDocument()
    expect(screen.getByText('Plano Grátis')).toBeInTheDocument()
    expect(screen.queryByText('Faturas')).not.toBeInTheDocument()
  })

  it('tells a non-owner to ask the owner instead of showing subscribe buttons', () => {
    render(
      <BillingPanel
        {...props({ tier: 'free', hasStripeCustomer: false, canManageBilling: false })}
      />,
    )
    expect(screen.getByText(/Peça ao dono do Negócio/, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assinar o Pro' })).not.toBeInTheDocument()
  })
})

describe('BillingPanel — payment method', () => {
  it('renders the masked card + expiry when a payment method is on file', () => {
    render(<BillingPanel {...props()} />)
    expect(screen.getByText(/Mastercard •••• 6717/)).toBeInTheDocument()
    expect(screen.getByText(/Expira 08\/2028/)).toBeInTheDocument()
  })

  it('shows an empty state when there is no card', () => {
    render(<BillingPanel {...props({ paymentMethod: null })} />)
    expect(screen.getByText(/Nenhum cartão salvo/, { exact: false })).toBeInTheDocument()
  })
})

describe('BillingPanel — invoices', () => {
  it('renders the invoice rows with amount, status and a link', () => {
    render(<BillingPanel {...props()} />)
    expect(screen.getByText('Paga')).toBeInTheDocument()
    expect(screen.getByText(/247,50/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver' })).toHaveAttribute(
      'href',
      'https://stripe.test/in_1',
    )
  })

  it('shows an empty state when there are no invoices', () => {
    render(<BillingPanel {...props({ invoices: [] })} />)
    expect(screen.getByText('Nenhuma fatura ainda.')).toBeInTheDocument()
  })
})

describe('BillingPanel — actions', () => {
  it('shows "Ajustar plano" for an owner on a paid plan', () => {
    render(<BillingPanel {...props()} />)
    expect(screen.getByRole('button', { name: 'Ajustar plano' })).toBeInTheDocument()
  })

  it('hides every action for a non-owner (manager read-only view)', () => {
    render(<BillingPanel {...props({ canManageBilling: false })} />)
    expect(screen.queryByRole('button', { name: 'Ajustar plano' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument()
  })

  it('calls startCheckout with the chosen tier when subscribing from Free', async () => {
    const user = userEvent.setup()
    render(<BillingPanel {...props({ tier: 'free', hasStripeCustomer: false })} />)

    await user.click(screen.getByRole('button', { name: 'Assinar o Pro' }))

    expect(mocks.startCheckout).toHaveBeenCalledTimes(1)
    const form = mocks.startCheckout.mock.calls[0]?.[0]
    expect(form?.get('tier')).toBe('pro')
  })

  it('calls manageBilling when adjusting the plan', async () => {
    const user = userEvent.setup()
    render(<BillingPanel {...props()} />)

    await user.click(screen.getByRole('button', { name: 'Ajustar plano' }))

    expect(mocks.manageBilling).toHaveBeenCalledTimes(1)
  })
})

describe('BillingPanel — native cancellation (brief 0090, AC-09)', () => {
  it('shows the cancellation zone for an owner on a live paid subscription', () => {
    render(<BillingPanel {...props({ cancelAtPeriodEnd: false })} />)
    expect(screen.getByText('Cancelamento', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar plano' })).toBeInTheDocument()
  })

  it('hides the cancellation zone once already scheduled to cancel', () => {
    render(<BillingPanel {...props({ cancelAtPeriodEnd: true })} />)
    expect(screen.queryByText('Cancelamento', { exact: true })).not.toBeInTheDocument()
  })

  it('hides the cancellation zone for a Free org and for a non-owner', () => {
    const { rerender } = render(
      <BillingPanel {...props({ tier: 'free', hasStripeCustomer: false })} />,
    )
    expect(screen.queryByText('Cancelamento', { exact: true })).not.toBeInTheDocument()
    rerender(<BillingPanel {...props({ canManageBilling: false })} />)
    expect(screen.queryByText('Cancelamento', { exact: true })).not.toBeInTheDocument()
  })

  it('opening the confirm dialog shows the preserve-access copy + retention escape', async () => {
    const user = userEvent.setup()
    render(<BillingPanel {...props({ tier: 'pro' })} />)

    await user.click(screen.getByRole('button', { name: 'Cancelar plano' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Você ainda poderá usar o Plano Pro/)
    expect(screen.getByRole('button', { name: 'Manter meu Plano Pro' })).toBeInTheDocument()
  })

  it('confirming calls cancelSubscription and toasts success', async () => {
    const user = userEvent.setup()
    mocks.cancelSubscription.mockResolvedValueOnce({ ok: true })
    render(<BillingPanel {...props()} />)

    await user.click(screen.getByRole('button', { name: 'Cancelar plano' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar plano' }))

    expect(mocks.cancelSubscription).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('toasts the error when cancellation fails', async () => {
    const user = userEvent.setup()
    mocks.cancelSubscription.mockResolvedValueOnce({ ok: false, error: 'Nada para cancelar' })
    render(<BillingPanel {...props()} />)

    await user.click(screen.getByRole('button', { name: 'Cancelar plano' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar plano' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Nada para cancelar')
  })
})
