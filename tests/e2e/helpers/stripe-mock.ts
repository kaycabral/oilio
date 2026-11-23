import Stripe from 'stripe'

import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from './secrets'

export function stripeApiBase(): string {
  const base = process.env.STRIPE_API_BASE
  if (!base) {
    throw new Error("STRIPE_API_BASE is not set — launch E2E through 'pnpm test:e2e'.")
  }
  return base
}

export function stripeMock(): Stripe {
  const url = new URL(stripeApiBase())
  return new Stripe(STRIPE_SECRET_KEY, {
    host: url.hostname,
    port: Number(url.port),
    protocol: 'http',
  })
}

export function signedWebhook(event: Record<string, unknown>): {
  body: string
  signature: string
} {
  const body = JSON.stringify(event)
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: STRIPE_WEBHOOK_SECRET,
  })
  return { body, signature }
}

export async function releaseStripeCustomer(stripeCustomerId: string): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM org_billing_stripe_index WHERE stripe_customer_id = $1', [
      stripeCustomerId,
    ])
    await client.query(
      'UPDATE org_billing SET stripe_customer_id = NULL WHERE stripe_customer_id = $1',
      [stripeCustomerId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

export async function readStripeBinding(
  orgId: string,
): Promise<{ stripeCustomerId: string | null; tier: string | null }> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query<{ stripe_customer_id: string | null; tier: string }>(
      'SELECT stripe_customer_id, tier FROM org_billing WHERE org_id = $1',
      [orgId],
    )
    const row = res.rows[0]
    return { stripeCustomerId: row?.stripe_customer_id ?? null, tier: row?.tier ?? null }
  } finally {
    await client.end()
  }
}
