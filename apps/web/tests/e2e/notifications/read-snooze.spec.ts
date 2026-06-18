// E2E spec — sub-issue #958 do brief 0018 (Grupo D).
//
// AC via browser real:
// - AC-16: "marcar como lida" remove do popover (order_stale — sem ação WA)
// - AC-17: "adiar" oculta do popover

import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function seedNotification(orgId: string, unitId: string, type: string): string {
  const notifId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${fsBaseUrl()}/organizations/${orgId}/notifications/${notifId}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          id: { stringValue: notifId },
          orgId: { stringValue: orgId },
          unitId: { stringValue: unitId },
          type: { stringValue: type },
          customerId: { nullValue: null },
          appointmentId: { nullValue: null },
          subscriptionId: { nullValue: null },
          payload: { mapValue: { fields: {} } },
          source: { stringValue: 'cron' },
          eventKey: { stringValue: `${type}-${notifId}` },
          createdAt: { stringValue: now },
          readAt: { nullValue: null },
          dispatchedAt: { nullValue: null },
          dispatchedChannel: { nullValue: null },
          dispatchedBody: { nullValue: null },
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
    seedNotification(org.orgId, org.unitIds[0]!, 'order_stale')

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
    seedNotification(org.orgId, org.unitIds[0]!, 'order_stale')

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
