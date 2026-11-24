import { NotificationConfig } from '@/domain/aggregates/notification/config'
import type { NotificationState, NotificationType } from '@/domain/aggregates/notification/types'
import { aggregateRef } from '@/domain/effect'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
} from '@/shared/db/pg/effect/notification-projector'
import { Schema } from 'effect'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { parseJson } from '../helpers/rest-json'
import {
  pgReadProjection,
  seedCustomer,
  setActiveUnitCookie,
  uniqueWhatsapp,
} from '../helpers/session'

test.use({ orgInput: { unitCount: 2 } })

function uniqueSuffix(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

async function seedNotification(
  orgId: string,
  unitId: string,
  type: NotificationType,
  customerId: string | null = null,
): Promise<string> {
  const notifId = `e2e-notif-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const doc: NotificationState = {
    id: notifId,
    orgId,
    unitId,
    type,
    customerId,
    appointmentId: null,
    subscriptionId: null,
    payload: {},
    source: 'cron',
    eventKey: `${type}-${notifId}`,
    createdAt: now,
    readAt: null,
    dispatchedAt: null,
    dispatchedChannel: null,
    dispatchedBody: null,
    validUntil: null,
    snoozedUntil: null,
    _version: 1,
  }
  const ref = aggregateRef(NotificationConfig, orgId, notifId)
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        ref.type,
        ref.id,
        ref.orgId,
        {
          _tag: 'notification.created',
          version: 1,
          timestamp: now,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: doc },
        },
      ],
    )
    const values = notificationColumnValues(doc, ref, 1)
    const placeholders = NOTIFICATION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO notifications (${NOTIFICATION_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      [...values],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
  return notifId
}

test.describe.serial('Brief 0018 — Definition of Done (Feature-level)', () => {
  test('Cenário 1: sininho + popover + wa.me marca dispatchedAt; outra unidade não aparece', async ({
    org,
    authedPage,
    context,
    baseURL,
  }) => {
    const unitA = org.unitIds[0]!
    const unitB = org.unitIds[1]!
    const wa = uniqueWhatsapp()
    const customerId = await seedCustomer(org.orgId, { name: 'Maria', mobile: wa })

    const birthdayNotif = await seedNotification(org.orgId, unitA, 'birthday', customerId)
    await seedNotification(org.orgId, unitB, 'new_customer', customerId)

    await setActiveUnitCookie(context, unitA, baseURL ?? undefined)
    await authedPage.goto('/agenda')
    await authedPage.waitForURL(/\/agenda$/)

    const loaded = authedPage.waitForResponse(
      (r) => /\/api\/notifications\?/.test(r.url()) && r.ok(),
    )
    await authedPage.getByRole('button', { name: 'Notificações' }).click()
    await loaded
    const popover = authedPage.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()

    await expect(popover.getByText('Aniversário')).toBeVisible()
    await expect(popover.getByText('Novo cliente')).toBeHidden()

    const dispatch = authedPage.waitForResponse(
      (r) =>
        r.url().includes(`/api/notifications/${birthdayNotif}/dispatch`) &&
        r.request().method() === 'POST',
    )
    await popover.getByRole('button', { name: 'Abrir WhatsApp' }).first().click()
    const res = await dispatch
    expect(res.ok()).toBe(true)
    expect(
      parseJson(await res.text(), Schema.decodeUnknownSync(Schema.Struct({ link: Schema.String })))
        .link,
    ).toContain(`https://wa.me/${wa}`)

    const notif = await pgReadProjection(
      'notifications',
      aggregateRef(NotificationConfig, org.orgId, birthdayNotif),
    )
    expect(notif?.dispatched_at).toBeTruthy()
  })

  test('Cenário 2: /notifications filtra por tipo + URL compartilhável + empty state', async ({
    org,
    authedPage,
    context,
    baseURL,
  }) => {
    const unitA = org.unitIds[0]!
    await seedNotification(org.orgId, unitA, 'birthday')
    await seedNotification(org.orgId, unitA, 'subscription_expired')

    await setActiveUnitCookie(context, unitA, baseURL ?? undefined)
    await authedPage.goto('/notifications')

    const list = authedPage.locator('ul')

    await expect(list.getByText('Aniversário')).toBeVisible()
    await expect(list.getByText('Vencida')).toBeVisible()

    await authedPage.getByRole('button', { name: 'Vencida' }).click()
    await authedPage.waitForURL(/type=subscription_expired/)
    await expect(list.getByText('Vencida')).toBeVisible()
    await expect(list.getByText('Aniversário')).toBeHidden()

    await authedPage.getByRole('button', { name: 'Follow-up' }).click()
    await authedPage.waitForURL(/type=subscription_overdue_followup/)
    await expect(authedPage.getByText('Nenhuma notificação encontrada')).toBeVisible()
  })
})
