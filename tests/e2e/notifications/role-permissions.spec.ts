import { NotificationConfig } from '@/domain/aggregates/notification/config'
import { NotificationState } from '@/domain/aggregates/notification/types'
import { aggregateRef } from '@/domain/effect'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
} from '@/shared/db/pg/effect/notification-projector'
import { patchUser } from '@/shared/db/pg/users-store'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { seedAuthUser, seedMembershipFor, signInAndAttachSession } from '../helpers/session'

async function setCurrentOrg(uid: string, orgId: string): Promise<void> {
  await patchUser(uid, { current_org_id: orgId }, new Date().toISOString())
}

const decodeNotificationType = Schema.decodeUnknownSync(NotificationState.fields.type)

async function seedNotification(orgId: string, unitId: string, type: string): Promise<void> {
  const notifId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  const ref = aggregateRef(NotificationConfig, orgId, notifId)
  const doc: NotificationState = {
    id: notifId,
    orgId,
    unitId,
    type: decodeNotificationType(type),
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
}

test.describe.serial('Notification role permissions (receptionist)', () => {
  test('AC-18: receptionist não vê tipos financeiros no sininho', async ({
    org,
    context,
    page,
    baseURL,
  }) => {
    const recep = await seedAuthUser()
    await seedMembershipFor(org.orgId, recep.uid, { role: 'receptionist' })
    await setCurrentOrg(recep.uid, org.orgId)

    const unitId = org.unitIds[0]!
    await seedNotification(org.orgId, unitId, 'birthday')
    await seedNotification(org.orgId, unitId, 'cash_register_open')
    await seedNotification(org.orgId, unitId, 'payment_failure')

    await signInAndAttachSession(context, recep.email, recep.password, baseURL ?? undefined)

    await page.goto('/agenda')

    const loaded = page.waitForResponse((r) => /\/api\/notifications\?/.test(r.url()) && r.ok())
    await page.getByRole('button', { name: 'Notificações' }).click()
    await loaded
    const popover = page.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()

    await expect(popover.getByText('Aniversário')).toBeVisible()
    await expect(popover.getByText('Caixa aberto')).toBeHidden()
    await expect(popover.getByText('Falha no pagamento')).toBeHidden()
  })

  test('AC-20: /settings/notifications é read-only pra receptionist', async ({
    org,
    context,
    page,
    baseURL,
  }) => {
    const recep = await seedAuthUser()
    await seedMembershipFor(org.orgId, recep.uid, { role: 'receptionist' })
    await setCurrentOrg(recep.uid, org.orgId)

    await signInAndAttachSession(context, recep.email, recep.password, baseURL ?? undefined)

    await page.goto('/settings/notifications')

    const birthdayBox = page.locator('#body-birthday')
    await expect(birthdayBox).toBeVisible()
    await expect(birthdayBox).toBeDisabled()
  })
})
