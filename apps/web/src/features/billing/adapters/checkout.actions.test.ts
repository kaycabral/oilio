// Unit tests for the checkout/portal server actions (brief 0073, AC-01/AC-03).
// These are the owner-only entry points into Stripe. Proven here without network
// or DB (all deps mocked, mirroring subscriptions.actions.test):
//   startCheckout — owner gate, tier/cycle validation, Free-has-no-price guard,
//     idempotent customer resolve (reuse vs lazily create + persist), quantity =
//     active unit count, the Checkout Session shape, and redirect to its url.
//   manageBilling — owner gate, "no customer" guard, portal session + redirect.
//
// `redirect` throws NEXT_REDIRECT in Next, so the happy paths assert the thrown
// sentinel carrying the target url; `toRoute` is mocked to identity (it's just the
// opaque-url narrowing seam).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOwnerCtx: vi.fn(),
  getOrgBilling: vi.fn(),
  listUnitsForOrg: vi.fn(),
  stripePriceId: vi.fn(),
  emitEvent:
    vi.fn<
      (
        config: unknown,
        ref: unknown,
        event: { _tag: string; payload: Record<string, unknown> },
      ) => Promise<{ ok: true }>
    >(),
  customersCreate: vi.fn(),
  checkoutCreate: vi.fn<(arg: Record<string, unknown>) => Promise<{ url: string | null }>>(),
  portalCreate: vi.fn(),
  requireEnv: vi.fn(() => 'https://app.oilio.test'),
}))

vi.mock('@/shared/org/membership', () => ({ requireOwnerCtx: mocks.requireOwnerCtx }))
vi.mock('@/shared/org/billing-read', () => ({ getOrgBilling: mocks.getOrgBilling }))
vi.mock('@/shared/org/unit-read', () => ({ listUnitsForOrg: mocks.listUnitsForOrg }))
vi.mock('@/shared/billing/stripe-prices', () => ({ stripePriceId: mocks.stripePriceId }))
vi.mock('@/shared/effect-bridge', () => ({ emitEvent: mocks.emitEvent }))
vi.mock('@cbrl/env', () => ({ requireEnv: mocks.requireEnv }))
vi.mock('@/shared/routes', () => ({ toRoute: (u: string) => u }))
vi.mock('@/shared/billing/stripe-client', () => ({
  getStripe: () => ({
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.checkoutCreate } },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

import { manageBilling, startCheckout } from './checkout.actions'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function ownerCtx() {
  return {
    ok: true as const,
    ctx: {
      session: { uid: 'owner-1' },
      membership: { orgId: 'org-1', role: 'owner' as const, userId: 'owner-1' },
    },
  }
}

function billing(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { orgId: 'org-1', tier: 'free', stripeCustomerId: null, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.emitEvent.mockResolvedValue({ ok: true })
})

describe('startCheckout', () => {
  it('rejects a non-owner with the guard error', async () => {
    mocks.requireOwnerCtx.mockResolvedValue({ ok: false, error: 'Apenas o dono' })

    const res = await startCheckout(form({ tier: 'pro', cycle: 'monthly' }))

    expect(res).toEqual({ ok: false, error: 'Apenas o dono' })
    expect(mocks.checkoutCreate).not.toHaveBeenCalled()
  })

  it('rejects an invalid tier/cycle', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())

    const res = await startCheckout(form({ tier: 'enterprise', cycle: 'monthly' }))

    expect(res).toEqual({ ok: false, error: 'Plano ou ciclo inválido' })
  })

  it('rejects when the tier has no price (Free)', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.stripePriceId.mockReturnValue(null)

    const res = await startCheckout(form({ tier: 'pro', cycle: 'monthly' }))

    expect(res).toEqual({ ok: false, error: 'Plano sem cobrança (Grátis não requer checkout)' })
  })

  it('lazily creates a Stripe customer (persisting it) when the org has none', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.stripePriceId.mockReturnValue('price_pro_monthly')
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: null }))
    mocks.customersCreate.mockResolvedValue({ id: 'cus_new' })
    mocks.listUnitsForOrg.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    mocks.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe/x' })

    await expect(startCheckout(form({ tier: 'pro', cycle: 'monthly' }))).rejects.toThrow(
      'NEXT_REDIRECT:https://checkout.stripe/x',
    )

    expect(mocks.customersCreate).toHaveBeenCalledWith({ metadata: { orgId: 'org-1' } })
    // persists the new customer id via an org_billing event
    expect(mocks.emitEvent).toHaveBeenCalledTimes(1)
    const emitArgs = mocks.emitEvent.mock.calls[0]
    expect(emitArgs?.[2]).toMatchObject({
      _tag: 'org_billing.updated',
      payload: { changes: { stripeCustomerId: 'cus_new' } },
    })
  })

  it('reuses the existing Stripe customer (idempotent, no create/persist)', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.stripePriceId.mockReturnValue('price_pro_monthly')
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: 'cus_existing' }))
    mocks.listUnitsForOrg.mockResolvedValue([{ id: 'u1' }])
    mocks.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe/y' })

    await expect(startCheckout(form({ tier: 'pro', cycle: 'monthly' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.emitEvent).not.toHaveBeenCalled()
  })

  it('creates a subscription Checkout Session with quantity = active units', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.stripePriceId.mockReturnValue('price_advanced_annual')
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: 'cus_1' }))
    mocks.listUnitsForOrg.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
    mocks.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe/z' })

    await expect(startCheckout(form({ tier: 'advanced', cycle: 'annual' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(mocks.checkoutCreate).toHaveBeenCalledTimes(1)
    const arg = mocks.checkoutCreate.mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      line_items: [{ price: 'price_advanced_annual', quantity: 3 }],
      client_reference_id: 'org-1',
      subscription_data: { metadata: { orgId: 'org-1' } },
    })
    // never pin payment_method_types (Stripe best-practice)
    expect(arg).not.toHaveProperty('payment_method_types')
  })

  it('floors quantity at 1 when the org has zero units', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.stripePriceId.mockReturnValue('price_pro_monthly')
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: 'cus_1' }))
    mocks.listUnitsForOrg.mockResolvedValue([])
    mocks.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe/q' })

    await expect(startCheckout(form({ tier: 'pro', cycle: 'monthly' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(mocks.checkoutCreate.mock.calls[0]?.[0]).toMatchObject({
      line_items: [{ quantity: 1 }],
    })
  })

  it('returns an error when Stripe yields no session url', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.stripePriceId.mockReturnValue('price_pro_monthly')
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: 'cus_1' }))
    mocks.listUnitsForOrg.mockResolvedValue([{ id: 'u1' }])
    mocks.checkoutCreate.mockResolvedValue({ url: null })

    const res = await startCheckout(form({ tier: 'pro', cycle: 'monthly' }))

    expect(res).toEqual({ ok: false, error: 'Falha ao iniciar o checkout' })
  })
})

describe('manageBilling', () => {
  it('rejects a non-owner', async () => {
    mocks.requireOwnerCtx.mockResolvedValue({ ok: false, error: 'Apenas o dono' })

    const res = await manageBilling()

    expect(res).toEqual({ ok: false, error: 'Apenas o dono' })
    expect(mocks.portalCreate).not.toHaveBeenCalled()
  })

  it('rejects when there is no subscription to manage', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: null }))

    const res = await manageBilling()

    expect(res).toEqual({
      ok: false,
      error: 'Nenhuma assinatura para gerenciar. Assine um plano primeiro.',
    })
    expect(mocks.portalCreate).not.toHaveBeenCalled()
  })

  it('opens the customer portal and redirects to its url', async () => {
    mocks.requireOwnerCtx.mockResolvedValue(ownerCtx())
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeCustomerId: 'cus_1' }))
    mocks.portalCreate.mockResolvedValue({ url: 'https://portal.stripe/p' })

    await expect(manageBilling()).rejects.toThrow('NEXT_REDIRECT:https://portal.stripe/p')

    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app.oilio.test/settings/billing',
    })
  })
})
