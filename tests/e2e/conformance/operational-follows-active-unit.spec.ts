import { NotificationConfig } from '@/domain/aggregates'
import type { NotificationState, NotificationType } from '@/domain/aggregates/notification/types'
import { aggregateRef } from '@/domain/effect'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
} from '@/shared/db/pg/effect/notification-projector'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { seedCustomer, seedOpenOrder, type SeededOrg } from '../helpers/session'

function uniqueSuffix(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

async function seedStaleOpenOrder(
  org: SeededOrg,
  unitId: string,
  customerId: string,
  totalCents: number,
): Promise<string> {
  return seedOpenOrder({
    orgId: org.orgId,
    unitId,
    customerId,
    attributedUserId: org.uid,
    totalCents,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  })
}

async function seedNotification(
  orgId: string,
  unitId: string,
  type: NotificationType,
): Promise<string> {
  const notifId = `e2e-notif-${uniqueSuffix()}`
  const now = new Date().toISOString()
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
        'notifications',
        ref.id,
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

test.describe(
  'Operational screens follow the active unit (#1090 · 0039 AC-01)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('Dashboard + Notificações follow the top switcher; no per-feature unit control', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = org.unitIds
      expect(unitA).toBeTruthy()
      expect(unitB).toBeTruthy()

      const custA = await seedCustomer(org.orgId, { name: 'Cliente Unidade A' })
      const custB = await seedCustomer(org.orgId, { name: 'Cliente Unidade B' })
      await seedStaleOpenOrder(org, unitA!, custA, 11100)
      await seedStaleOpenOrder(org, unitB!, custB, 22200)

      await seedNotification(org.orgId, unitA!, 'birthday')
      await seedNotification(org.orgId, unitB!, 'new_customer')

      const switcher = authedPage.getByLabel('Contexto da unidade')

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher).toContainText('Unidade 1')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 222,00')).toBeHidden()
      await expect(authedPage.getByRole('combobox', { name: 'Unidade' })).toHaveCount(0)

      await authedPage.goto('/notifications')
      await expect(authedPage.getByRole('heading', { name: 'Notificações' })).toBeVisible()
      const list = authedPage.locator('ul')
      await expect(list.getByText('Aniversário')).toBeVisible()
      await expect(list.getByText('Novo cliente')).toBeHidden()
      const notificationsMain = authedPage.locator('main.p-6')
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 1', exact: true }),
      ).toHaveCount(0)
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 2', exact: true }),
      ).toHaveCount(0)

      await switcher.click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher).toContainText('Unidade 2')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByText('R$ 222,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeHidden()

      await authedPage.goto('/notifications')
      await expect(list.getByText('Novo cliente')).toBeVisible()
      await expect(list.getByText('Aniversário')).toBeHidden()
    })
  },
)
