// E2E spec — sub-issue #957 do brief 0018 (Grupo C).
//
// AC [smoke] via browser real:
// - AC-13: owner edita template em /settings/notifications e persiste
// - AC-14: clique "abrir WhatsApp" gera link wa.me + marca dispatchedAt +
//   grava snapshot channel/body no notification.dispatched

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { decodeFsFieldsDoc, parseJson, strField, type FsValue } from '../helpers/firestore-rest'
import { seedCustomer } from '../helpers/session'

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function seedBirthdayNotification(orgId: string, unitId: string, customerId: string): string {
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
          type: { stringValue: 'birthday' },
          customerId: { stringValue: customerId },
          appointmentId: { nullValue: null },
          subscriptionId: { nullValue: null },
          payload: { mapValue: { fields: {} } },
          source: { stringValue: 'cron' },
          eventKey: { stringValue: `birthday-${notifId}` },
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

function getNotification(orgId: string, notifId: string): Record<string, FsValue> {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      '-H',
      'Authorization: Bearer owner',
      `${fsBaseUrl()}/organizations/${orgId}/notifications/${notifId}`,
    ],
    { encoding: 'utf8' },
  )
  return parseJson(out, decodeFsFieldsDoc).fields ?? {}
}

test.describe.serial('Notification template + wa.me dispatch', () => {
  test('AC-13: owner edita template e persiste', async ({ authedPage }) => {
    await authedPage.goto('/settings/notifications')

    const birthdayBox = authedPage.locator('#body-birthday')
    await expect(birthdayBox).toBeVisible()

    const novo = 'Parabéns {cliente_nome}! 🎂 Bom demais te ver por aqui.'
    await birthdayBox.fill(novo)

    // Preview reflete o texto editado (AC-15)
    await expect(authedPage.getByText('Parabéns Maria! 🎂', { exact: false })).toBeVisible()

    // Salva o card de birthday
    await authedPage
      .locator('form', { has: authedPage.locator('#body-birthday') })
      .getByRole('button', { name: 'Salvar' })
      .click()
    await expect(authedPage.getByText('Salvo!')).toBeVisible()

    // Persistiu: reload mantém o texto
    await authedPage.reload()
    await expect(authedPage.locator('#body-birthday')).toHaveValue(novo)
  })

  test('AC-14: clique wa.me gera link + marca dispatchedAt + snapshot', async ({
    org,
    authedPage,
  }) => {
    const customerId = seedCustomer(org.orgId, { name: 'Maria', whatsapp: '11999998888' })
    const notifId = seedBirthdayNotification(org.orgId, org.unitIds[0]!, customerId)

    await authedPage.goto('/agenda')

    // Opening the popover refetches /api/notifications, picking up the seeded
    // birthday notification deterministically (no reload/sleep needed).
    const loaded = authedPage.waitForResponse(
      (r) => /\/api\/notifications\?/.test(r.url()) && r.ok(),
    )
    await authedPage.getByRole('button', { name: 'Notificações' }).click()
    await loaded
    const popover = authedPage.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()

    // Intercepta a resposta do dispatch ao clicar no botão WhatsApp
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
    expect(body.link).toContain('https://wa.me/5511999998888')
    expect(body.link).toContain('Maria')

    // Firestore: dispatchedAt + snapshot
    const notif = getNotification(org.orgId, notifId)
    expect(notif).toHaveProperty('dispatchedChannel')
    const channel = strField(notif, 'dispatchedChannel')
    expect(channel).toBe('wa_link')
    const dispatchedBody = strField(notif, 'dispatchedBody')
    expect(dispatchedBody).toContain('{cliente_nome}')
  })
})
