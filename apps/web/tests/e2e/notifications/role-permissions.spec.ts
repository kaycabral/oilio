// E2E spec — sub-issue #959 do brief 0018 (Grupo E).
//
// AC via browser real, com sessão de RECEPTIONIST (não o owner do fixture):
// - AC-18: receptionist NÃO vê cash_register_open/payment_failure no sininho
// - AC-20: /settings/notifications é read-only pra receptionist

import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedAuthUser, seedMembershipFor, signInAndAttachSession } from '../helpers/session'

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function curlPatch(url: string, body: unknown): void {
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
      JSON.stringify(body),
    ],
    { encoding: 'utf8' },
  )
}

function setCurrentTenant(uid: string, tenantId: string): void {
  curlPatch(`${fsBaseUrl()}/users/${uid}?updateMask.fieldPaths=currentTenantId`, {
    fields: { currentTenantId: { stringValue: tenantId } },
  })
}

function seedNotification(tenantId: string, unitId: string, type: string): void {
  const notifId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  curlPatch(`${fsBaseUrl()}/tenants/${tenantId}/notifications/${notifId}`, {
    fields: {
      id: { stringValue: notifId },
      tenantId: { stringValue: tenantId },
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
  })
}

test.describe.serial('Notification role permissions (receptionist)', () => {
  test('AC-18: receptionist não vê tipos financeiros no sininho', async ({
    tenant,
    context,
    page,
    baseURL,
  }) => {
    const recep = await seedAuthUser()
    seedMembershipFor(tenant.tenantId, recep.uid, { role: 'receptionist' })
    setCurrentTenant(recep.uid, tenant.tenantId)

    const unitId = tenant.unitIds[0]!
    seedNotification(tenant.tenantId, unitId, 'birthday')
    seedNotification(tenant.tenantId, unitId, 'cash_register_open')
    seedNotification(tenant.tenantId, unitId, 'payment_failure')

    await signInAndAttachSession(context, recep.email, recep.password, baseURL ?? undefined)

    await page.goto('/agenda')

    // Opening the popover refetches /api/notifications, so the receptionist's
    // role-filtered list is loaded deterministically (no reload/sleep needed).
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
    tenant,
    context,
    page,
    baseURL,
  }) => {
    const recep = await seedAuthUser()
    seedMembershipFor(tenant.tenantId, recep.uid, { role: 'receptionist' })
    setCurrentTenant(recep.uid, tenant.tenantId)

    await signInAndAttachSession(context, recep.email, recep.password, baseURL ?? undefined)

    await page.goto('/settings/notifications')

    // Vê os templates, mas os campos estão desabilitados (read-only).
    const birthdayBox = page.locator('#body-birthday')
    await expect(birthdayBox).toBeVisible()
    await expect(birthdayBox).toBeDisabled()
  })
})
