// E2E spec — sub-issue #958 do brief 0018 (Grupo D).
//
// AC via browser real:
// - AC-16: "marcar como lida" remove do popover (order_stale — sem ação WA)
// - AC-17: "adiar" oculta do popover

import { NotificationConfig } from '@/domain/aggregates/notification/config'
import type { NotificationState, NotificationType } from '@/domain/aggregates/notification/types'
import { aggregateRef } from '@/domain/effect'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
} from '@/shared/db/pg/effect/notification-projector'
import type { Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'

// Seeds an `order_stale` notification straight into the Postgres event store
// (post-cutover): one tx writing the `notification.created` event (version 1)
// plus the typed `notifications` projection row, using the same column helpers
// the runtime projector writes (so the seed can't drift from production).
async function seedNotification(
  orgId: string,
  unitId: string,
  type: NotificationType,
): Promise<string> {
  const notifId = `e2e-notif-${Date.now()}-${randomBytes(4).toString('hex')}`
  const now = new Date().toISOString()
  const ref = aggregateRef(NotificationConfig, orgId, notifId)
  const doc: NotificationState = {
    id: notifId,
    orgId,
    unitId,
    type,
    customerId: null,
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
    const placeholders = NOTIFICATION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO notifications (${NOTIFICATION_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      [...notificationColumnValues(doc, ref, 1)],
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

async function openBellWithItem(authedPage: Page) {
  await authedPage.goto('/agenda')
  // Opening the popover refetches /api/notifications (the bell fetches on mount
  // AND on open), so we don't need to reload/sleep for the seeded item — wait
  // deterministically for that fetch to settle, then assert.
  const loaded = authedPage.waitForResponse((r) => /\/api\/notifications\?/.test(r.url()) && r.ok())
  await authedPage.getByRole('button', { name: 'Notificações' }).click()
  await loaded
  const popover = authedPage.locator('[data-slot="popover-content"]')
  await expect(popover).toBeVisible()
  return popover
}

test.describe.serial('Notification read + snooze', () => {
  test('AC-16: marcar como lida remove do popover', async ({ org, authedPage }) => {
    await seedNotification(org.orgId, org.unitIds[0]!, 'order_stale')

    const popover = await openBellWithItem(authedPage)
    await expect(popover.getByText('Venda pendente')).toBeVisible()

    const readResponse = authedPage.waitForResponse(
      (r) => /\/api\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === 'POST',
    )
    await popover.getByRole('button', { name: 'Marcar como lida' }).first().click()
    expect((await readResponse).ok()).toBe(true)

    await expect(popover.getByText('Venda pendente')).toBeHidden()
  })

  test('AC-17: adiar oculta do popover', async ({ org, authedPage }) => {
    await seedNotification(org.orgId, org.unitIds[0]!, 'order_stale')

    const popover = await openBellWithItem(authedPage)
    await expect(popover.getByText('Venda pendente')).toBeVisible()

    await popover.getByRole('button', { name: 'Adiar' }).first().click()
    const snoozeResponse = authedPage.waitForResponse(
      (r) => /\/api\/notifications\/.+\/snooze$/.test(r.url()) && r.request().method() === 'POST',
    )
    await authedPage.getByRole('menuitem', { name: 'Adiar 4h' }).click()
    expect((await snoozeResponse).ok()).toBe(true)

    await expect(popover.getByText('Venda pendente')).toBeHidden()
  })
})
