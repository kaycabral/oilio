import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const WEBHOOK_SECRET = 'whsec_test_secret'
const PRO_MONTHLY = 'price_pro_monthly_test'

const stripe = new Stripe('sk_test_unused', { apiVersion: '2026-10-28.endive' })

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn<(id: string) => Promise<Stripe.Subscription>>(),
}))

vi.mock('@/shared/billing/stripe-client', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: (body: string, sig: string, secret: string) =>
        stripe.webhooks.constructEvent(body, sig, secret),
    },
    subscriptions: { retrieve: mocks.retrieve },
  }),
}))

import { POST } from './route'

function checkoutPayload(orgId: string, subId: string): string {
  return JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-10-28.endive',
    data: {
      object: {
        id: 'cs_1',
        object: 'checkout.session',
        client_reference_id: orgId,
        customer: 'cus_1',
        subscription: subId,
        metadata: { orgId },
      },
    },
  })
}

function signedRequest(payload: string, signature?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  const sig =
    signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  if (sig !== '__none__') headers.set('stripe-signature', sig)
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body: payload,
  })
}

function subscriptionObject(subId: string, orgId: string): unknown {
  return {
    id: subId,
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { orgId },
    items: {
      object: 'list',
      data: [
        {
          id: `si_${subId}`,
          object: 'subscription_item',
          quantity: 1,
          current_period_end: 1_900_000_000,
          current_period_start: 1_897_408_000,
          price: { id: PRO_MONTHLY, object: 'price' },
        },
      ],
    },
  }
}

function buildSubscription(subId: string, orgId: string): Stripe.Subscription {
  const payload = JSON.stringify({
    id: 'evt_sub',
    object: 'event',
    type: 'customer.subscription.updated',
    api_version: '2026-10-28.endive',
    data: { object: subscriptionObject(subId, orgId) },
  })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  const ev = stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET)
  if (ev.type !== 'customer.subscription.updated') throw new Error('unreachable')
  return ev.data.object
}

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [id],
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await res.json()
  if (!isRecord(parsed)) throw new Error('unexpected webhook response body')
  return parsed
}

async function eventCount(): Promise<number> {
  const res = await getEventStorePool().query<{ n: string }>(
    'SELECT count(*)::text AS n FROM stripe_webhook_events',
  )
  return Number(res.rows[0]?.n ?? 0)
}

describe('Stripe webhook route (brief 0074, AC-01/AC-02)', () => {
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_PRICE_PRO_MONTHLY = PRO_MONTHLY
    process.env.STRIPE_PRICE_PRO_ANNUAL = 'price_pro_annual_test'
    process.env.STRIPE_PRICE_ADVANCED_MONTHLY = 'price_advanced_monthly_test'
    process.env.STRIPE_PRICE_ADVANCED_ANNUAL = 'price_advanced_annual_test'
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.retrieve.mockImplementation((id: string) =>
      Promise.resolve(buildSubscription(id, 'org-1')),
    )
    await getEventStorePool().query(
      'TRUNCATE stripe_webhook_events, org_billing_stripe_index, org_billing, orgs, events CASCADE',
    )
    await seedOrg('org-1')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('rejects a request with no stripe-signature header (400)', async () => {
    const res = await POST(signedRequest(checkoutPayload('org-1', 'sub_1'), '__none__'))
    expect(res.status).toBe(400)
  })

  it('rejects an invalid signature (400)', async () => {
    const res = await POST(signedRequest(checkoutPayload('org-1', 'sub_1'), 't=1,v1=deadbeef'))
    expect(res.status).toBe(400)
  })

  it('processes a valid event once (200 received) and records the id', async () => {
    const res = await POST(signedRequest(checkoutPayload('org-1', 'sub_1')))
    const body = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ received: true })
    expect(body.duplicate).toBeUndefined()
    expect(await eventCount()).toBe(1)
  })

  it('short-circuits a duplicate delivery to 200 {duplicate:true} without reprocessing', async () => {
    const payload = checkoutPayload('org-1', 'sub_1')

    const first = await POST(signedRequest(payload))
    expect((await bodyOf(first)).received).toBe(true)
    const callsAfterFirst = mocks.retrieve.mock.calls.length

    const second = await POST(signedRequest(payload))
    const body = await bodyOf(second)

    expect(second.status).toBe(200)
    expect(body).toMatchObject({ received: true, duplicate: true })
    expect(mocks.retrieve.mock.calls.length).toBe(callsAfterFirst)
    expect(await eventCount()).toBe(1)
  })

  it('releases the reserved id and returns 500 when the handler throws (Stripe will retry)', async () => {
    mocks.retrieve.mockRejectedValue(new Error('downstream boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(signedRequest(checkoutPayload('org-1', 'sub_1')))

    expect(res.status).toBe(500)
    expect(await eventCount()).toBe(0)

    errSpy.mockRestore()
  })
})
