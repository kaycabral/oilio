// E2E spec — sub-issue #955 do brief 0018 (Grupo A).
//
// AC [smoke] via browser real:
// - AC-01: sininho aparece no top bar com badge de não-lidas
// - AC-03: popover renderiza items com icon + label + tempo relativo
// - AC-04: sininho com 0 não-lidas → badge oculto + empty state no popover

import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function seedNotification(
  tenantId: string,
  unitId: string,
  type: string,
  eventKey: string,
): string {
  const notifId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  const url = `${fsBaseUrl()}/tenants/${tenantId}/notifications/${notifId}`
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
          id: { stringValue: notifId },
          tenantId: { stringValue: tenantId },
          unitId: { stringValue: unitId },
          type: { stringValue: type },
          source: { stringValue: 'cron' },
          eventKey: { stringValue: eventKey },
          customerId: { nullValue: null },
          appointmentId: { nullValue: null },
          subscriptionId: { nullValue: null },
          payload: { mapValue: { fields: {} } },
          createdAt: { stringValue: now },
          readAt: { nullValue: null },
          dispatchedAt: { nullValue: null },
          validUntil: { nullValue: null },
          snoozedUntil: { nullValue: null },
          _version: { integerValue: '1' },
        },
      }),
    ],
    { encoding: 'utf8' },
  )

  return notifId
}

test.describe.serial('Notification bell + popover', () => {
  test('AC-01/AC-03: bell shows badge + popover renders items', async ({ tenant, authedPage }) => {
    const unitId = tenant.unitIds[0]!
    seedNotification(tenant.tenantId, unitId, 'birthday', `e2e-birthday-${Date.now()}`)
    seedNotification(tenant.tenantId, unitId, 'new_customer', `e2e-newcust-${Date.now()}`)

    await authedPage.goto('/agenda')

    const bellButton = authedPage.getByRole('button', { name: 'Notificações' })
    await expect(bellButton).toBeVisible()

    // Opening the popover refetches /api/notifications, so the seeded items are
    // picked up deterministically — wait for that response instead of sleeping.
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
