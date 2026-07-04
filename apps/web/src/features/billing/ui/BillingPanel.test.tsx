// Render tests for the BillingPanel (brief 0073, AC-03) — the self-service
// billing surface. Proves the status/flag branches a tester would eyeball:
// status badges, the "Cancela no fim do ciclo" flag, "Acesso até" vs "Próxima
// cobrança", Free vs paid layout (no "Unidades cobradas" on Free), the
// subscribe vs portal action split, and the owner-only gating of the actions.
//
// The server actions and toast are mocked (no network); the focus is the markup
// each prop combination produces.

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
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    hasStripeCustomer: true,
    canManageBilling: true,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BillingPanel — current plan', () => {
  it('shows the tier name and the localized status badge', () => {
    render(<BillingPanel {...props({ tier: 'pro', status: 'past_due' })} />)
    expect(screen.getByText('Plano Pro')).toBeInTheDocument()
    expect(screen.getByText('Pagamento pendente')).toBeInTheDocument()
  })

  it('falls back to the raw status when unmapped', () => {
    render(<BillingPanel {...props({ status: 'weird_state' })} />)
    expect(screen.getByText('weird_state')).toBeInTheDocument()
  })

  it('shows the cancel-at-period-end flag and labels the date "Acesso até"', () => {
    render(<BillingPanel {...props({ cancelAtPeriodEnd: true })} />)
    expect(screen.getByText('Cancela no fim do ciclo')).toBeInTheDocument()
    expect(screen.getByText('Acesso até')).toBeInTheDocument()
    expect(screen.queryByText('Próxima cobrança')).not.toBeInTheDocument()
  })

  it('labels the date "Próxima cobrança" when not canceling', () => {
    render(<BillingPanel {...props({ cancelAtPeriodEnd: false })} />)
    expect(screen.getByText('Próxima cobrança')).toBeInTheDocument()
    expect(screen.queryByText('Cancela no fim do ciclo')).not.toBeInTheDocument()
  })

  it('surfaces both the unit count and the billed quantity on a paid plan', () => {
    render(<BillingPanel {...props({ unitCount: 5, unitQuantity: 4 })} />)
    expect(screen.getByText('Unidades neste Negócio')).toBeInTheDocument()
    expect(screen.getByText('Unidades cobradas')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('hides billed quantity and cycle on a Free plan', () => {
    render(
      <BillingPanel
        {...props({
          tier: 'free',
          status: 'active',
          billingCycle: null,
          currentPeriodEnd: null,
          hasStripeCustomer: false,
        })}
      />,
    )
    expect(screen.getByText('Plano Grátis')).toBeInTheDocument()
    expect(screen.queryByText('Unidades cobradas')).not.toBeInTheDocument()
    expect(screen.queryByText('Ciclo')).not.toBeInTheDocument()
  })
})

describe('BillingPanel — actions', () => {
  it('shows the portal action when the org has a Stripe customer', () => {
    render(<BillingPanel {...props({ hasStripeCustomer: true })} />)
    expect(screen.getByRole('button', { name: 'Abrir portal de cobrança' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assinar o Pro' })).not.toBeInTheDocument()
  })

  it('shows the subscribe actions when there is no Stripe customer yet', () => {
    render(<BillingPanel {...props({ tier: 'free', hasStripeCustomer: false })} />)
    expect(screen.getByRole('button', { name: 'Assinar o Pro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assinar o Avançado' })).toBeInTheDocument()
  })

  it('hides every action for a non-owner (manager read-only view)', () => {
    render(<BillingPanel {...props({ canManageBilling: false })} />)
    expect(
      screen.queryByRole('button', { name: 'Abrir portal de cobrança' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assinar o Pro' })).not.toBeInTheDocument()
  })

  it('calls startCheckout with the chosen tier when subscribing', async () => {
    const user = userEvent.setup()
    render(<BillingPanel {...props({ tier: 'free', hasStripeCustomer: false })} />)

    await user.click(screen.getByRole('button', { name: 'Assinar o Pro' }))

    expect(mocks.startCheckout).toHaveBeenCalledTimes(1)
    const form = mocks.startCheckout.mock.calls[0]?.[0]
    expect(form?.get('tier')).toBe('pro')
  })

  it('toasts the error when checkout fails', async () => {
    const user = userEvent.setup()
    mocks.startCheckout.mockResolvedValueOnce({ ok: false, error: 'Plano inválido' })
    render(<BillingPanel {...props({ tier: 'free', hasStripeCustomer: false })} />)

    await user.click(screen.getByRole('button', { name: 'Assinar o Avançado' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Plano inválido')
  })

  it('calls manageBilling when opening the portal', async () => {
    const user = userEvent.setup()
    render(<BillingPanel {...props({ hasStripeCustomer: true })} />)

    await user.click(screen.getByRole('button', { name: 'Abrir portal de cobrança' }))

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
    // The destructive confirm inside the dialog (distinct from the trigger).
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
