import { NotificationConfig } from '@/domain/aggregates/notification/config'
import type { NotificationState } from '@/domain/aggregates/notification/types'
import { aggregateRef } from '@/domain/effect'
import {
  NOTIFICATION_COLUMNS,
  notificationColumnValues,
} from '@/shared/db/pg/effect/notification-projector'
import { Schema } from 'effect'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { fillStable } from '../helpers/hydration'
import { parseJson } from '../helpers/rest-json'
import { pgReadProjection, seedCustomer, uniqueWhatsapp } from '../helpers/session'

async function seedBirthdayNotification(
  orgId: string,
  unitId: string,
  customerId: string,
): Promise<string> {
  const notifId = `e2e-notif-${Date.now()}-${randomBytes(4).toString('hex')}`
  const now = new Date().toISOString()
  const ref = aggregateRef(NotificationConfig, orgId, notifId)
  const doc: NotificationState = {
    id: notifId,
    orgId,
    unitId,
    type: 'birthday',
    customerId,
    appointmentId: null,
    subscriptionId: null,
    payload: {},
    source: 'cron',
    eventKey: `birthday-${notifId}`,
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

const DispatchSnapshot = Schema.Struct({
  dispatchedChannel: Schema.NullOr(Schema.String),
  dispatchedBody: Schema.NullOr(Schema.String),
})
const decodeDispatch = Schema.decodeUnknownSync(Schema.NullOr(DispatchSnapshot))

test.describe.serial('Notification template + wa.me dispatch', () => {
  test('AC-13: owner edita template e persiste', async ({ authedPage }) => {
    await authedPage.goto('/settings/notifications')

    const birthdayBox = authedPage.locator('#body-birthday')
    await expect(birthdayBox).toBeVisible()

    const novo = 'Parabéns {cliente_nome}! 🎂 Bom demais te ver por aqui.'
    await fillStable(birthdayBox, novo)

    await expect(birthdayBox).toHaveValue(novo)

    await authedPage
      .locator('form', { has: authedPage.locator('#body-birthday') })
      .getByRole('button', { name: 'Salvar' })
      .click()
    await expect(authedPage.getByText('Salvo!')).toBeVisible()

    await authedPage.reload()
    await expect(authedPage.locator('#body-birthday')).toHaveValue(novo, { timeout: 15000 })
  })

  test('AC-14: clique wa.me gera link + marca dispatchedAt + snapshot', async ({
    org,
    authedPage,
  }) => {
    const wa = uniqueWhatsapp()
    const customerId = await seedCustomer(org.orgId, { name: 'Maria', mobile: wa })
    const notifId = await seedBirthdayNotification(org.orgId, org.unitIds[0]!, customerId)

    await authedPage.goto('/agenda')

    const loaded = authedPage.waitForResponse(
      (r) => /\/api\/notifications\?/.test(r.url()) && r.ok(),
    )
    await authedPage.getByRole('button', { name: 'Notificações' }).click()
    await loaded
    const popover = authedPage.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()

    const dispatchResponse = authedPage.waitForResponse(
      (r) =>
        r.url().includes(`/api/notifications/${notifId}/dispatch`) &&
        r.request().method() === 'POST',
    )
    await popover.getByRole('button', { name: 'Abrir WhatsApp' }).first().click()
    const res = await dispatchResponse
    expect(res.ok()).toBe(true)
    const body = parseJson(
      await res.text(),
      Schema.decodeUnknownSync(Schema.Struct({ link: Schema.String })),
    )
    expect(body.link).toContain(`https://wa.me/${wa}`)
    expect(body.link).toContain('Maria')

    const row = await pgReadProjection(
      'notifications',
      aggregateRef(NotificationConfig, org.orgId, notifId),
    )
    expect(row).not.toBeNull()
    expect(row?.dispatched_at).not.toBeNull()
    const dispatch = decodeDispatch(row?.dispatch)
    expect(dispatch).not.toBeNull()
    expect(dispatch?.dispatchedChannel).toBe('wa_link')
    expect(dispatch?.dispatchedBody).toContain('{cliente_nome}')
  })
})
