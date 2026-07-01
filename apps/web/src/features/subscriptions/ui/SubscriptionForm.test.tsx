import type {
  CustomerLite,
  PlanLite,
} from '@/features/subscriptions/adapters/load-subscription-form'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionForm } from './SubscriptionForm'

// `createSubscription(formData)` is the server action the form dispatches via
// `<form action>`. Stub it at that boundary; assertions read the submitted
// FormData back to confirm the wired-up billingCycle.
type ActionResult = { ok: true; subscriptionId: string } | { ok: false; error: string }
type CreateAction = (formData: FormData) => Promise<ActionResult>

const mocks = vi.hoisted(() => ({
  createSubscription: vi.fn<CreateAction>(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('@/features/subscriptions/adapters/subscriptions.actions', () => ({
  createSubscription: mocks.createSubscription,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush, refresh: mocks.routerRefresh }),
}))

const CUSTOMERS: CustomerLite[] = [{ id: 'c1', name: 'João' }]

// plans[0] is annual (the mount default), plans[1] is monthly — switching to it
// must re-derive the billing cycle (the bug: it stayed annual).
const PLANS: PlanLite[] = [
  { id: 'plan-annual', name: 'Anual VIP', priceCents: 89900, billingCycle: 'annual', active: true },
  { id: 'plan-monthly', name: 'Mensal', priceCents: 9900, billingCycle: 'monthly', active: true },
]

beforeEach(() => {
  mocks.createSubscription.mockReset()
  mocks.routerPush.mockReset()
  mocks.routerRefresh.mockReset()
})

describe('SubscriptionForm — billing cycle follows the plan (#B5)', () => {
  it('derives the cycle from the default plan on mount', () => {
    render(<SubscriptionForm customers={CUSTOMERS} plans={PLANS} />)
    expect(screen.getByRole('combobox', { name: /ciclo de cobrança/i })).toHaveTextContent('Anual')
  })

  it('re-derives the cycle when the plan changes', () => {
    render(<SubscriptionForm customers={CUSTOMERS} plans={PLANS} />)
    // Switch from the annual default to the monthly plan.
    fireEvent.click(screen.getByRole('combobox', { name: /plano/i }))
    fireEvent.click(screen.getByRole('option', { name: /Mensal —/i }))
    expect(screen.getByRole('combobox', { name: /ciclo de cobrança/i })).toHaveTextContent('Mensal')
  })

  it('submits the re-derived billing cycle', async () => {
    mocks.createSubscription.mockResolvedValue({ ok: true, subscriptionId: 'sub1' })
    render(<SubscriptionForm customers={CUSTOMERS} plans={PLANS} />)

    fireEvent.click(screen.getByRole('combobox', { name: /cliente/i }))
    fireEvent.click(screen.getByRole('option', { name: 'João' }))
    fireEvent.click(screen.getByRole('combobox', { name: /plano/i }))
    fireEvent.click(screen.getByRole('option', { name: /Mensal —/i }))

    fireEvent.click(screen.getByRole('button', { name: /criar assinatura/i }))
    await waitFor(() => expect(mocks.createSubscription).toHaveBeenCalledTimes(1))
    const fd = mocks.createSubscription.mock.calls[0]![0]
    expect(fd.get('billingCycle')).toBe('monthly')
    expect(fd.get('planId')).toBe('plan-monthly')
  })
})
