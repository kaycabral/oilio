import { handleStripeEvent } from '@/features/billing/adapters/stripe-webhook'
import { getStripe } from '@/shared/billing/stripe-client'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { withRequestContext } from '@/shared/lib/request-context'
import { requireEnv } from '@cbrl/env'
import { NextResponse } from 'next/server'

// Stripe webhook (brief 0074). Must run on Node (raw body + crypto signature
// check; the pg pool is not Edge-compatible) and must never be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Reserve an event.id for processing (AC-02). Returns true if this is the first
// time we see it (we own the processing), false if already recorded (duplicate
// delivery → caller returns 200 without re-applying). Insert-first BEFORE the
// state change so a crash mid-handle does NOT leave the id marked done — see the
// rollback on failure below.
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

  // Raw body is REQUIRED for signature verification — never parse/re-serialize
  // before constructEvent, or the computed signature won't match.
  const rawBody = await request.text()

  const stripe = getStripe()
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, requireEnv('STRIPE_WEBHOOK_SECRET'))
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Dedup: claim the id first. A duplicate delivery short-circuits to 200.
  const fresh = await reserveEvent(event.id)
  if (!fresh) return NextResponse.json({ received: true, duplicate: true })

  try {
    await handleStripeEvent(event, {
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    })
  } catch (err) {
    // A handle failure must NOT keep the id marked done — release it so Stripe's
    // retry reprocesses, and return 500 so Stripe knows to retry.
    await releaseEvent(event.id)
    console.error('[stripe-webhook] handle failed', event.type, event.id, err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

// Wrap so the whole handler runs inside a correlation-id scope (brief 0086 AC-04).
export const POST = withRequestContext(postHandler)
