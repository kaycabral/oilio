import { NotificationConfig } from '@/domain/aggregates/notification/config'
import type { NotificationState } from '@/domain/aggregates/notification/types'
import { aggregateRef } from '@/domain/effect'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
} from '@/shared/db/pg/effect/notification-projector'
import { expect, test } from '../fixtures'

async function seedNotification(
  orgId: string,
  unitId: string,
  type: NotificationState['type'],
  eventKey: string,
): Promise<string> {
  const notifId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  const ref = aggregateRef(NotificationConfig, orgId, notifId)
  const doc: NotificationState = {
    id: notifId,
    orgId,
    unitId,
    type,
    source: 'cron',
    eventKey,
    customerId: null,
    appointmentId: null,
    subscriptionId: null,
    payload: {},
    createdAt: now,
    readAt: null,
    dispatchedAt: null,
    dispatchedChannel: null,
    dispatchedBody: null,
    validUntil: null,
    snoozedUntil: null,
    _version: 1,
  }

  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        'notifications',
        notifId,
        orgId,
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

test.describe.serial('Notification bell + popover', () => {
  test('AC-01/AC-03: bell shows badge + popover renders items', async ({ org, authedPage }) => {
    const unitId = org.unitIds[0]!
    await seedNotification(org.orgId, unitId, 'birthday', `e2e-birthday-${Date.now()}`)
    await seedNotification(org.orgId, unitId, 'new_customer', `e2e-newcust-${Date.now()}`)

    await authedPage.goto('/agenda')

    const bellButton = authedPage.getByRole('button', { name: 'Notificações' })
    await expect(bellButton).toBeVisible()

    const loaded = authedPage.waitForResponse(
      (r) => /\/api\/notifications\?/.test(r.url()) && r.ok(),
    )
    await bellButton.click()
    await loaded

    const popover = authedPage.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()

    await expect(popover.getByText('Aniversário')).toBeVisible()
    await expect(popover.getByText('Novo cliente')).toBeVisible()
    await expect(popover.getByText('Ver todas')).toBeVisible()
  })

  test('AC-04: 0 unread → no badge + empty state', async ({ authedPage }) => {
    await authedPage.goto('/agenda')

    const bellButton = authedPage.getByRole('button', { name: 'Notificações' })
    await expect(bellButton).toBeVisible()

    const badge = bellButton.locator('.rounded-full')
    await expect(badge).toBeHidden()

    await bellButton.click()

    const popover = authedPage.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()
    await expect(popover.getByText('Nenhuma notificação pendente')).toBeVisible()
  })
})
