// E2E spec — sub-issue #956 do brief 0018 (Grupo B).
//
// AC [smoke] via endpoint direto (não-UI):
// - AC-07: cron diário gera 3 toques de vencimento (D-1, D+1, D+7)
// - AC-10: idempotência — rodar 2× não duplica
//
// Testa via POST /api/cron/daily-notifications contra Postgres (post-cutover).

import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { readJson } from '../helpers/rest-json'
import { CRON_SECRET } from '../helpers/secrets'
import { pgQueryProjection, seedCustomer, seedSubscription } from '../helpers/session'

// Patches the seeded subscription's `currentPeriod.endAt` directly on the
// `subscriptions` projection (the cron reads `currentPeriod.endAt` off the
// projection — `generate-daily.ts`). Post-cutover the period is a JSONB column;
// `jsonb_set` rewrites only the `endAt` key, leaving `startAt`/`consumed` intact
// (mirrors the old Firestore updateMask on `currentPeriod.endAt`).
async function patchSubscriptionPeriod(orgId: string, subId: string, endAt: string): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `UPDATE subscriptions
         SET current_period = jsonb_set(current_period, '{endAt}', to_jsonb($3::text))
       WHERE org_id = $1 AND id = $2`,
      [orgId, subId, endAt],
    )
  } finally {
    await client.end()
  }
}

// Reads the subscription-expiring notifications for a given subscription in an
// org. Post-cutover the notifications live in the typed `notifications` table
// (snake_case columns); we filter by `subscription_id` and narrow to the org +
// type in JS (same predicate the old Firestore composite query expressed).
async function readExpiringTomorrowNotifications(
  orgId: string,
  subId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await pgQueryProjection('notifications', 'subscription_id', subId)
  return rows.filter((r) => r.org_id === orgId && r.type === 'subscription_expiring_tomorrow')
}

// Seeded units open 09:00 (America/Sao_Paulo = UTC-3).
// Cron window: [open-45min, open-15min] = [08:15, 08:45] local = [11:15, 11:45] UTC.
// We pick a Wednesday (weekday with businessHours) at 08:30 local → 11:30 UTC.
function cronNowForDate(localDate: string): string {
  return `${localDate}T11:30:00.000Z`
}

function nextWeekday(): string {
  const d = new Date()
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function shiftDate(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

test.describe.serial('Notification cron — subscription touches', () => {
  test('AC-07: D-1 creates subscription_expiring_tomorrow', async ({ org, baseURL }) => {
    const customerId = await seedCustomer(org.orgId)
    const subId = await seedSubscription(org.orgId, customerId, { status: 'active' })

    const today = nextWeekday()
    const tomorrow = shiftDate(today, 1)
    const endAtUTC = `${tomorrow}T12:00:00.000Z`
    await patchSubscriptionPeriod(org.orgId, subId, endAtUTC)

    const now = cronNowForDate(today)
    const res = await fetch(
      `${baseURL}/api/cron/daily-notifications?now=${encodeURIComponent(now)}`,
      {
        method: 'POST',
        headers: { 'x-cron-secret': CRON_SECRET },
      },
    )
    expect(res.ok).toBe(true)
    const body = await readJson(
      res,
      Schema.decodeUnknownSync(Schema.Struct({ created: Schema.Number })),
    )
    expect(body.created).toBeGreaterThanOrEqual(1)

    const docs = await readExpiringTomorrowNotifications(org.orgId, subId)

    expect(docs.length).toBeGreaterThanOrEqual(1)
  })

  test('AC-10: idempotent — second cron call does not duplicate', async ({ org, baseURL }) => {
    const customerId = await seedCustomer(org.orgId)
    const subId = await seedSubscription(org.orgId, customerId, { status: 'active' })

    const today = nextWeekday()
    const tomorrow = shiftDate(today, 1)
    const endAtUTC = `${tomorrow}T12:00:00.000Z`
    await patchSubscriptionPeriod(org.orgId, subId, endAtUTC)

    const now = cronNowForDate(today)
    const first = await fetch(
      `${baseURL}/api/cron/daily-notifications?now=${encodeURIComponent(now)}`,
      {
        method: 'POST',
        headers: { 'x-cron-secret': CRON_SECRET },
      },
    )
    expect(
      (await readJson(first, Schema.decodeUnknownSync(Schema.Struct({ created: Schema.Number }))))
        .created,
    ).toBeGreaterThanOrEqual(1)

    const second = await fetch(
      `${baseURL}/api/cron/daily-notifications?now=${encodeURIComponent(now)}`,
      {
        method: 'POST',
        headers: { 'x-cron-secret': CRON_SECRET },
      },
    )
    expect(
      (await readJson(second, Schema.decodeUnknownSync(Schema.Struct({ created: Schema.Number }))))
        .created,
    ).toBe(0)

    const docs = await readExpiringTomorrowNotifications(org.orgId, subId)

    const unitCount = org.unitIds.length
    expect(docs).toHaveLength(unitCount)
  })
})
