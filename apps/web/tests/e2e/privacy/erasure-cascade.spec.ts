import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { aggregateRef } from '@/domain/effect'
import { Client } from 'pg'
import { expect, test } from '../fixtures'
import {
  pgReadProjection,
  seedAppointment,
  seedCustomer,
  seedOrg,
  seedSubscription,
  signInAndAttachSession,
} from '../helpers/session'

// Feature-level E2E — CUSTOMER erasure CASCADE (brief 0032 / #1101, AC-12 +
// AC-14, Cenário 7).
//
// When a CUSTOMER is erased (per-org block), the cascade cancels their active
// subscription immediately (+ stops its pending charges) and cancels their
// FUTURE appointments; PAST appointments are retained. This spec drives the
// cascade's OUTPUT through the event-store projections (the status transitions
// `eraseCustomerCascadeInOrg` writes server-side) the same way the sibling
// `per-org-erasure.spec.ts` simulates the block's marker/archive — then
// asserts the read surfaces an owner sees reflect it:
//   - the subscriptions list shows the subscription as `Cancelada`;
//   - the agenda no longer surfaces the customer's future appointment;
//   - the PAST appointment doc is retained (de-identified, not deleted).
//
// The cascade MECHANISM itself (event-first cancels, idempotency, AC-14) is
// covered exhaustively by `erase-customer-cascade.integration.test.ts` against
// the real server-side code; this spec is the read-side acceptance.

// Runs a raw projection UPDATE through the event-store pool — the Postgres
// equivalent of the old admin Firestore PATCH. Simulates the cascade's OUTPUT
// (the status transitions it projects) without replaying the server-side saga,
// exactly as the integration test owns the mechanism. e2e runs as superuser, so
// RLS is bypassed.
async function pgUpdate(sql: string, params: unknown[]): Promise<void> {
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(sql, params)
  } finally {
    await client.end()
  }
}

// Cancels a subscription the way the cascade projects it: status `cancelled`
// WITH a `cancelled_at` timestamp. The Subscription schema enforces
// `cancelledAt` present iff cancelled, so flipping status alone would write an
// illegal row that the strict-decoding read rejects.
async function cancelSubscription(orgId: string, id: string, now: string): Promise<void> {
  await pgUpdate(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $3 WHERE org_id = $1 AND id = $2`,
    [orgId, id, now],
  )
}

// Flips an appointment's `status` — what the cascade's event-first cancel
// projects onto a future scheduled booking.
async function setAppointmentStatus(orgId: string, id: string, status: string): Promise<void> {
  await pgUpdate(`UPDATE appointments SET status = $3 WHERE org_id = $1 AND id = $2`, [
    orgId,
    id,
    status,
  ])
}

// Anchored at NOON UTC so the calendar date is stable across the org timezone
// (the agenda queries the org-local day): a midnight-relative `Date.now()+2d`
// could land on a different local day than its UTC `slice(0,10)`, which made the
// agenda assertion flaky by time-of-day. Noon ± any real tz offset stays the same
// date.
function atNoonUtc(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  d.setUTCHours(12, 0, 0, 0)
  return d.toISOString()
}
const future = () => atNoonUtc(2)
const past = () => atNoonUtc(-2)

test.describe('CUSTOMER erasure cascade', { tag: '@critical' }, () => {
  test('erasing a customer with an active subscription cancels it + future appointments; past appointment retained', async ({
    context,
  }) => {
    const owner = await seedOrg({ memberOperationCount: 1 })
    const unitId = owner.unitIds[0]!
    const memberOperationId = owner.memberOperationIds[0]!

    const customerName = `Cliente Cascata ${Date.now()}`
    const customerId = await seedCustomer(owner.orgId, { name: customerName })

    // Active subscription + a future and a past appointment for this customer.
    const subId = await seedSubscription(owner.orgId, customerId, { status: 'active' })
    const futureStart = future()
    const futureAppt = await seedAppointment({
      orgId: owner.orgId,
      unitId,
      memberOperationId,
      customerId,
      serviceId: 'e2e-svc',
      startAt: futureStart,
      endAt: new Date(new Date(futureStart).getTime() + 30 * 60_000).toISOString(),
      status: 'scheduled',
    })
    const pastStart = past()
    const pastAppt = await seedAppointment({
      orgId: owner.orgId,
      unitId,
      memberOperationId,
      customerId,
      serviceId: 'e2e-svc',
      startAt: pastStart,
      endAt: new Date(new Date(pastStart).getTime() + 30 * 60_000).toISOString(),
      status: 'completed',
    })

    // Erasure cascade OUTPUT — the status transitions the saga projects:
    // active subscription → cancelled; future scheduled appointment → cancelled;
    // the past (completed) appointment is LEFT untouched.
    await cancelSubscription(owner.orgId, subId, new Date().toISOString())
    await setAppointmentStatus(owner.orgId, futureAppt, 'cancelled')

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    // Subscriptions list (Encerradas tab): the subscription now reads as
    // cancelled — it left the "open" tab and lands under cancelled.
    await page.goto('/subscriptions?status=cancelled')
    await expect(page.getByText(customerName).first()).toBeVisible()
    await expect(page.getByText('Cancelada').first()).toBeVisible()

    // Agenda for the future day: the customer's appointment is now CANCELLED.
    // Cancelled appointments are hidden from the grid by default (brief 0081), so
    // the slot reads as free — confirm that first, then flip the toggle on
    // (`?showCancelled=1`) and assert the block is retained as history, rendered
    // struck-through (`line-through`), i.e. no longer an active slot.
    const futureDate = futureStart.slice(0, 10)
    await page.goto(`/agenda?date=${futureDate}`)
    await expect(page.getByRole('button', { name: customerName })).toHaveCount(0)
    await page.goto(`/agenda?date=${futureDate}&showCancelled=1`)
    const cancelledBlock = page.locator('.line-through').filter({ hasText: customerName })
    await expect(cancelledBlock).toHaveCount(1)
    await page.close()

    // The PAST appointment doc is retained (de-identified, not deleted) — AC-04
    // retention: erasure stops the future, never destroys the fiscal past.
    const retained = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, owner.orgId, pastAppt),
    )
    expect(retained).not.toBeNull()
    expect(retained?.status).toBe('completed')
  })
})
