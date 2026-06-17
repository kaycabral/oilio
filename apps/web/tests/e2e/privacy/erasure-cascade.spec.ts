import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { strField } from '../helpers/firestore-rest'
import {
  readAppointment,
  seedAppointment,
  seedCustomer,
  seedSubscription,
  seedTenant,
  signInAndAttachSession,
} from '../helpers/session'

// Feature-level E2E — CUSTOMER erasure CASCADE (brief 0032 / #1101, AC-12 +
// AC-14, Cenário 7).
//
// When a CUSTOMER is erased (per-tenant block), the cascade cancels their active
// subscription immediately (+ stops its pending charges) and cancels their
// FUTURE appointments; PAST appointments are retained. This spec drives the
// cascade's OUTPUT through the emulator (the status transitions
// `eraseCustomerCascadeInTenant` writes server-side) the same way the sibling
// `per-tenant-erasure.spec.ts` simulates the block's marker/archive — then
// asserts the read surfaces an owner sees reflect it:
//   - the subscriptions list shows the subscription as `Cancelada`;
//   - the agenda no longer surfaces the customer's future appointment;
//   - the PAST appointment doc is retained (de-identified, not deleted).
//
// The cascade MECHANISM itself (event-first cancels, idempotency, AC-14) is
// covered exhaustively by `erase-customer-cascade.integration.test.ts` against
// the real server-side code; this spec is the read-side acceptance.

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// PATCHes a doc's `status` field — what the cascade's event-first cancel projects
// onto the subscription/appointment/charge docs. `Authorization: Bearer owner`
// is the emulator's admin escape hatch.
function setStatus(path: string, status: string): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/${path}?updateMask.fieldPaths=status`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { status: { stringValue: status } } }),
    ],
    { encoding: 'utf8' },
  )
}

// Cancels a subscription the way the cascade projects it: status `cancelled`
// WITH a `cancelledAt` timestamp. The Subscription schema enforces
// `cancelledAt` present iff cancelled, so patching status alone would write an
// illegal doc that the strict-decoding read rejects.
function cancelSubscription(path: string, now: string): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/${path}?updateMask.fieldPaths=status&updateMask.fieldPaths=cancelledAt`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: { status: { stringValue: 'cancelled' }, cancelledAt: { stringValue: now } },
      }),
    ],
    { encoding: 'utf8' },
  )
}

// Anchored at NOON UTC so the calendar date is stable across the tenant timezone
// (the agenda queries the tenant-local day): a midnight-relative `Date.now()+2d`
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
    const owner = await seedTenant({ professionalCount: 1 })
    const unitId = owner.unitIds[0]!
    const professionalId = owner.professionalIds[0]!

    const customerName = `Cliente Cascata ${Date.now()}`
    const customerId = seedCustomer(owner.tenantId, { name: customerName })

    // Active subscription + a future and a past appointment for this customer.
    const subId = seedSubscription(owner.tenantId, customerId, { status: 'active' })
    const futureStart = future()
    const futureAppt = seedAppointment({
      tenantId: owner.tenantId,
      unitId,
      professionalId,
      customerId,
      serviceId: 'e2e-svc',
      startAt: futureStart,
      endAt: new Date(new Date(futureStart).getTime() + 30 * 60_000).toISOString(),
      status: 'scheduled',
    })
    const pastStart = past()
    const pastAppt = seedAppointment({
      tenantId: owner.tenantId,
      unitId,
      professionalId,
      customerId,
      serviceId: 'e2e-svc',
      startAt: pastStart,
      endAt: new Date(new Date(pastStart).getTime() + 30 * 60_000).toISOString(),
      status: 'completed',
    })

    // Erasure cascade OUTPUT — the status transitions the saga projects:
    // active subscription → cancelled; future scheduled appointment → cancelled;
    // the past (completed) appointment is LEFT untouched.
    cancelSubscription(`tenants/${owner.tenantId}/subscriptions/${subId}`, new Date().toISOString())
    setStatus(`tenants/${owner.tenantId}/appointments/${futureAppt}`, 'cancelled')

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    // Subscriptions list (Encerradas tab): the subscription now reads as
    // cancelled — it left the "open" tab and lands under cancelled.
    await page.goto('/subscriptions?status=cancelled')
    await expect(page.getByText(customerName).first()).toBeVisible()
    await expect(page.getByText('Cancelada').first()).toBeVisible()

    // Agenda for the future day: the customer's appointment is now CANCELLED —
    // the agenda retains the block (history) but renders it struck-through
    // (`line-through`), i.e. no longer an active slot. The block must NOT show
    // as an active appointment.
    const futureDate = futureStart.slice(0, 10)
    await page.goto(`/agenda?date=${futureDate}`)
    const cancelledBlock = page.locator('.line-through').filter({ hasText: customerName })
    await expect(cancelledBlock).toHaveCount(1)
    await page.close()

    // The PAST appointment doc is retained (de-identified, not deleted) — AC-04
    // retention: erasure stops the future, never destroys the fiscal past.
    const retained = readAppointment(owner.tenantId, pastAppt)
    expect(retained).not.toBeNull()
    expect(strField(retained ?? undefined, 'status')).toBe('completed')
  })
})
