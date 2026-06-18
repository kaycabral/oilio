// Feature E2E — brief 0039, AC-01 (sub-issue #1090).
//
// Operational screens follow the ACTIVE UNIT from the shared context (0029),
// with NO per-feature unit filter/switcher of their own. Here we prove:
//   - Dashboard pendências ("hoje") and Notificações render only the active
//     unit's data; switching the unit via the TOP switcher
//     (labelled "Contexto da unidade") flips both together;
//   - neither Dashboard nor Notificações exposes a per-feature unit control
//     anymore (the unit <select> / unit toggle buttons are gone).
//
// Runs against the running emulator (no mocks). Seeds via the session helpers +
// Firestore REST admin bypass.

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedCustomer, seedOpenOrder, type SeededOrg } from '../helpers/session'

function uniqueSuffix(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

// Seeds an open Order projection backdated >24h so it surfaces as a stale
// comanda pendency on the dashboard, scoped to its unit. Routes through the
// central typed helper (complete, schema-valid Order); `createdAt` is backdated
// past the >24h staleness threshold (`selectOpenOrderPendencies`).
function seedStaleOpenOrder(
  org: SeededOrg,
  unitId: string,
  customerId: string,
  totalCents: number,
): string {
  return seedOpenOrder({
    orgId: org.orgId,
    unitId,
    customerId,
    attributedUserId: org.uid,
    totalCents,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  })
}

function seedNotification(orgId: string, unitId: string, type: string): string {
  const notifId = `e2e-notif-${uniqueSuffix()}`
  const now = new Date().toISOString()
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${fsBaseUrl()}/orgs/${orgId}/notifications/${notifId}`,
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
    { stdio: 'pipe' },
  )
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

      // One distinct stale open order per unit → dashboard pendency by amount.
      const custA = seedCustomer(org.orgId, { name: 'Cliente Unidade A' })
      const custB = seedCustomer(org.orgId, { name: 'Cliente Unidade B' })
      seedStaleOpenOrder(org, unitA!, custA, 11100)
      seedStaleOpenOrder(org, unitB!, custB, 22200)

      // One distinct notification type per unit (birthday on A, new_customer
      // on B) so each unit's notifications are identifiable by label.
      seedNotification(org.orgId, unitA!, 'birthday')
      seedNotification(org.orgId, unitB!, 'new_customer')

      const switcher = authedPage.getByLabel('Contexto da unidade')

      // First access: a 2-unit member must pick a unit before any surface.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher).toContainText('Unidade 1')

      // --- Active unit = A ---
      // Dashboard pendências show only unit A's stale order (by amount), and the
      // dashboard has NO per-feature unit filter anymore.
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 222,00')).toBeHidden()
      await expect(authedPage.getByRole('combobox', { name: 'Unidade' })).toHaveCount(0)

      // Notificações show only unit A's notification, with NO unit toggle. The
      // per-feature unit control lived inside the page content (the main region),
      // not the header — scope the negative assertion there to exclude the top
      // switcher (whose accessible name also contains a unit name).
      await authedPage.goto('/notifications')
      await expect(authedPage.getByRole('heading', { name: 'Notificações' })).toBeVisible()
      const list = authedPage.locator('ul')
      await expect(list.getByText('Aniversário')).toBeVisible()
      await expect(list.getByText('Novo cliente')).toBeHidden()
      // Inner content region (`<main class="flex-1 p-6">`) — excludes the
      // sidebar-inset `<main>` that wraps the header/top switcher. Exact-name
      // match so the switcher button ("... Unidade 1") doesn't count.
      const notificationsMain = authedPage.locator('main.p-6')
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 1', exact: true }),
      ).toHaveCount(0)
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 2', exact: true }),
      ).toHaveCount(0)

      // --- Switch to unit B via the TOP switcher ---
      await switcher.click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher).toContainText('Unidade 2')

      // Dashboard + Notificações both flip to unit B.
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByText('R$ 222,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeHidden()

      await authedPage.goto('/notifications')
      await expect(list.getByText('Novo cliente')).toBeVisible()
      await expect(list.getByText('Aniversário')).toBeHidden()
    })
  },
)
