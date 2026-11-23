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

async function pgUpdate(sql: string, params: unknown[]): Promise<void> {
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(sql, params)
  } finally {
    await client.end()
  }
}

async function cancelSubscription(orgId: string, id: string, now: string): Promise<void> {
  await pgUpdate(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $3 WHERE org_id = $1 AND id = $2`,
    [orgId, id, now],
  )
}

async function setAppointmentStatus(orgId: string, id: string, status: string): Promise<void> {
  await pgUpdate(`UPDATE appointments SET status = $3 WHERE org_id = $1 AND id = $2`, [
    orgId,
    id,
    status,
  ])
}

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

    await cancelSubscription(owner.orgId, subId, new Date().toISOString())
    await setAppointmentStatus(owner.orgId, futureAppt, 'cancelled')

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/subscriptions?status=cancelled')
    await expect(page.getByText(customerName).first()).toBeVisible()
    await expect(page.getByText('Cancelada').first()).toBeVisible()

    const futureDate = futureStart.slice(0, 10)
    await page.goto(`/agenda?date=${futureDate}`)
    await expect(page.getByRole('button', { name: customerName })).toHaveCount(0)
    await page.goto(`/agenda?date=${futureDate}&showCancelled=1`)
    const cancelledBlock = page.locator('.line-through').filter({ hasText: customerName })
    await expect(cancelledBlock).toHaveCount(1)
    await page.close()

    const retained = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, owner.orgId, pastAppt),
    )
    expect(retained).not.toBeNull()
    expect(retained?.status).toBe('completed')
  })
})
