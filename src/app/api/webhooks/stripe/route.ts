import { handleStripeEvent } from '@/features/billing/adapters/stripe-webhook'
import { getStripe } from '@/shared/billing/stripe-client'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { requireEnv } from '@cbrl/env'
import { logger, withRequestContext } from '@cbrl/log'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function reserveEvent(eventId: string): Promise<boolean> {
  const res = await getEventStorePool().query(
    'INSERT INTO stripe_webhook_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING',
    [eventId],
  )
  return res.rowCount === 1
}

async function releaseEvent(eventId: string): Promise<void> {
  await getEventStorePool()
    .query('DELETE FROM stripe_webhook_events WHERE event_id = $1', [eventId])
    .catch(() => {})
}

async function postHandler(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const rawBody = await request.text()

  const stripe = getStripe()
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, requireEnv('STRIPE_WEBHOOK_SECRET'))
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const fresh = await reserveEvent(event.id)
  if (!fresh) return NextResponse.json({ received: true, duplicate: true })

  try {
    await handleStripeEvent(event, {
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    })
  } catch (err) {
    await releaseEvent(event.id)
    logger.error('handle failed', {
      scope: 'stripe-webhook',
      eventType: event.type,
      eventId: event.id,
      err,
    })
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

export const POST = withRequestContext(postHandler)
