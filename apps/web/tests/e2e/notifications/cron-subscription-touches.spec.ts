// E2E spec — sub-issue #956 do brief 0018 (Grupo B).
//
// AC [smoke] via endpoint direto (não-UI):
// - AC-07: cron diário gera 3 toques de vencimento (D-1, D+1, D+7)
// - AC-10: idempotência — rodar 2× não duplica
//
// Testa via POST /api/cron/daily-notifications contra Firestore emulator.

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import {
  decodeFsQueryRows,
  parseJson,
  readJson,
  type FsDocument,
  type FsValue,
} from '../helpers/firestore-rest'
import { CRON_SECRET } from '../helpers/secrets'
import { seedCustomer, seedSubscription } from '../helpers/session'

type FsScalar = string | number | null

function toFirestoreValue(value: FsScalar): FsValue {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  return { nullValue: null }
}

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function fsQuery(
  collectionPath: string,
  filters: { field: string; op: string; value: FsScalar }[],
): FsDocument[] {
  const parentParts = collectionPath.split('/')
  const collId = parentParts.pop()!
  const parent = parentParts.join('/')
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collId }],
  }

  if (filters.length > 0) {
    structuredQuery['where'] = {
      compositeFilter: {
        op: 'AND',
        filters: filters.map((f) => ({
          fieldFilter: {
            field: { fieldPath: f.field },
            op: f.op,
            value: toFirestoreValue(f.value),
          },
        })),
      },
    }
  }

  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${parent}:runQuery`
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'POST',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ structuredQuery }),
    ],
    { encoding: 'utf8' },
  )
  const results = parseJson(out, decodeFsQueryRows)
  return results.map((r) => r.document).filter((doc): doc is FsDocument => doc !== undefined)
}

function patchSubscriptionPeriod(orgId: string, subId: string, endAt: string): void {
  const url = `${fsBaseUrl()}/organizations/${orgId}/subscriptions/${subId}?updateMask.fieldPaths=currentPeriod.endAt`
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          currentPeriod: {
            mapValue: {
              fields: {
                endAt: { stringValue: endAt },
              },
            },
          },
        },
      }),
    ],
    { encoding: 'utf8' },
  )
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
    const customerId = seedCustomer(org.orgId)
    const subId = seedSubscription(org.orgId, customerId, { status: 'active' })

    const today = nextWeekday()
    const tomorrow = shiftDate(today, 1)
    const endAtUTC = `${tomorrow}T12:00:00.000Z`
    patchSubscriptionPeriod(org.orgId, subId, endAtUTC)

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

    const docs = fsQuery(`orgs/${org.orgId}/notifications`, [
      { field: 'type', op: 'EQUAL', value: 'subscription_expiring_tomorrow' },
      { field: 'subscriptionId', op: 'EQUAL', value: subId },
    ])

    expect(docs.length).toBeGreaterThanOrEqual(1)
  })

  test('AC-10: idempotent — second cron call does not duplicate', async ({ org, baseURL }) => {
    const customerId = seedCustomer(org.orgId)
    const subId = seedSubscription(org.orgId, customerId, { status: 'active' })

    const today = nextWeekday()
    const tomorrow = shiftDate(today, 1)
    const endAtUTC = `${tomorrow}T12:00:00.000Z`
    patchSubscriptionPeriod(org.orgId, subId, endAtUTC)

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

    const docs = fsQuery(`orgs/${org.orgId}/notifications`, [
      { field: 'type', op: 'EQUAL', value: 'subscription_expiring_tomorrow' },
      { field: 'subscriptionId', op: 'EQUAL', value: subId },
    ])

    const unitCount = org.unitIds.length
    expect(docs).toHaveLength(unitCount)
  })
})
