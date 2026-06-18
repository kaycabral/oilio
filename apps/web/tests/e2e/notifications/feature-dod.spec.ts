// Feature-level E2E — brief 0018 § Definition of Done (parent #954).
//
// 1 test por scenario do DoD, jornada cross-component (sininho + popover +
// wa.me dispatch + rota /notifications) integrando as 5 sub-issues
// (#955 UI, #956 backend, #957 template/wa.me, #958 read/snooze, #959 role).
//
// Roda contra emulators + dev server (E2E_DEV=1).

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { decodeFsFieldsDoc, parseJson, strField, type FsValue } from '../helpers/firestore-rest'
import { seedCustomer, setActiveUnitCookie } from '../helpers/session'

// Org com 2 unidades pra validar isolamento por unidade (Cenário 1).
test.use({ orgInput: { unitCount: 2 } })

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function seedNotification(
  orgId: string,
  unitId: string,
  type: string,
  customerId: string | null = null,
): string {
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
          customerId: customerId ? { stringValue: customerId } : { nullValue: null },
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

test.describe.serial('Brief 0018 — Definition of Done (Feature-level)', () => {
  // Cenário 1: Sininho com badge + popover + ação rápida (isolamento por unidade)
  test('Cenário 1: sininho + popover + wa.me marca dispatchedAt; outra unidade não aparece', async ({
    org,
    authedPage,
    context,
    baseURL,
  }) => {
    const unitA = org.unitIds[0]!
    const unitB = org.unitIds[1]!
    const customerId = seedCustomer(org.orgId, { name: 'Maria', whatsapp: '11999998888' })

    const birthdayNotif = seedNotification(org.orgId, unitA, 'birthday', customerId)
    seedNotification(org.orgId, unitB, 'new_customer', customerId)

    // 2-unit member: pin the active unit (A) so the `/select-unit` interstitial
    // (brief 0029) doesn't gate the shell; the bell + page follow the active
    // unit (brief 0039 AC-01), so unitB's notifications stay hidden.
    await setActiveUnitCookie(context, unitA, baseURL ?? undefined)
    await authedPage.goto('/agenda')
    // The pinned active-unit cookie keeps the shell on /agenda (no `/select-unit`
    // interstitial) — assert that deterministically instead of branching on the
    // landing URL.
    await authedPage.waitForURL(/\/agenda$/)

    // Badge + popover — opening the popover refetches /api/notifications, so the
    // seeded items load deterministically (no reload/sleep needed).
    const loaded = authedPage.waitForResponse(
      (r) => /\/api\/notifications\?/.test(r.url()) && r.ok(),
    )
    await authedPage.getByRole('button', { name: 'Notificações' }).click()
    await loaded
    const popover = authedPage.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()

    // Unidade ativa (A) aparece; unidade B NÃO
    await expect(popover.getByText('Aniversário')).toBeVisible()
    await expect(popover.getByText('Novo cliente')).toBeHidden()

    // Ação rápida wa.me → marca dispatchedAt
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
    ).toContain('https://wa.me/5511999998888')

    const notif = getNotification(org.orgId, birthdayNotif)
    expect(strField(notif, 'dispatchedAt')).toBeTruthy()
  })

  // Cenário 2: Rota /notifications com filtros por tipo + unidade + empty state + URL
  test('Cenário 2: /notifications filtra por tipo + URL compartilhável + empty state', async ({
    org,
    authedPage,
    context,
    baseURL,
  }) => {
    const unitA = org.unitIds[0]!
    seedNotification(org.orgId, unitA, 'birthday')
    seedNotification(org.orgId, unitA, 'subscription_expired')

    // 2-unit member: pin the active unit (A) so `/notifications` doesn't bounce
    // to the `/select-unit` interstitial (0029); the page follows the active unit.
    await setActiveUnitCookie(context, unitA, baseURL ?? undefined)
    await authedPage.goto('/notifications')

    // Escopa pra LISTA (os labels também aparecem nos chips de filtro).
    const list = authedPage.locator('ul')

    // Lista mostra ambos os tipos
    await expect(list.getByText('Aniversário')).toBeVisible()
    await expect(list.getByText('Vencida')).toBeVisible()

    // Filtra por tipo → só o tipo escolhido + URL reflete (compartilhável)
    await authedPage.getByRole('button', { name: 'Vencida' }).click()
    await authedPage.waitForURL(/type=subscription_expired/)
    await expect(list.getByText('Vencida')).toBeVisible()
    await expect(list.getByText('Aniversário')).toBeHidden()

    // Empty state: filtra por um tipo sem dados
    await authedPage.getByRole('button', { name: 'Follow-up' }).click()
    await authedPage.waitForURL(/type=subscription_overdue_followup/)
    await expect(authedPage.getByText('Nenhuma notificação encontrada')).toBeVisible()
  })
})
