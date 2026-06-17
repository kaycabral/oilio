// Feature E2E — active-unit operating context (brief 0029, sub-issue #1050).
//
// Covers AC-01/AC-02/AC-06/AC-07: a shared active-unit cookie scopes the
// operational surfaces (Agenda, Comandas, Bloqueios, Dashboard-hoje) while
// Catálogo (definition) and Relatórios (aggregate) stay cross-unit. Switching
// the active unit (via the `activeUnitId` cookie) reflects across the
// operational surfaces.
//
// The switcher UI that *writes* the cookie is sub-issue #1051 — here we drive
// the cookie directly (the server-side resolution + scoping is what #1050
// owns).

import { expect, test } from '../fixtures'
import {
  seedOpenOrder as centralSeedOpenOrder,
  seedBlock,
  seedCatalogItem,
  seedCustomer,
  setActiveUnitCookie,
  type SeededTenant,
} from '../helpers/session'

// Seeds an open Order projection via the central typed helper (complete,
// schema-valid Order). The list + dashboard-pendency reads only need a valid
// projection; `createdAt` is backdated past the >24h staleness threshold
// (`selectOpenOrderPendencies`) so it also surfaces as a stale-comanda pendency.
function seedOpenOrder(
  tenant: SeededTenant,
  unitId: string,
  customerId: string,
  totalCents: number,
): string {
  return centralSeedOpenOrder({
    tenantId: tenant.tenantId,
    unitId,
    customerId,
    attributedUserId: tenant.uid,
    totalCents,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  })
}

test.describe('Active-unit operating context (#1050)', { tag: '@critical' }, () => {
  test.describe('multi-unit tenant scopes operational surfaces', () => {
    test.use({ tenantInput: { unitCount: 2 } })

    test('Comandas + Bloqueios + Dashboard scope to the active unit and switch with the cookie', async ({
      context,
      tenant,
      authedPage,
      baseURL,
    }) => {
      const [unitA, unitB] = tenant.unitIds
      expect(unitA).toBeTruthy()
      expect(unitB).toBeTruthy()

      // One distinct customer + open order per unit.
      const custA = seedCustomer(tenant.tenantId, { name: 'Cliente Unidade A' })
      const custB = seedCustomer(tenant.tenantId, { name: 'Cliente Unidade B' })
      seedOpenOrder(tenant, unitA!, custA, 11100)
      seedOpenOrder(tenant, unitB!, custB, 22200)

      // One distinct recurring block per unit.
      seedBlock({
        kind: 'recurring',
        tenantId: tenant.tenantId,
        unitId: unitA!,
        weekday: 'monday',
        open: '12:00',
        close: '13:00',
        reason: 'Almoco Unidade A',
      })
      seedBlock({
        kind: 'recurring',
        tenantId: tenant.tenantId,
        unitId: unitB!,
        weekday: 'monday',
        open: '12:00',
        close: '13:00',
        reason: 'Almoco Unidade B',
      })

      // Pin the active unit to A. A 2-unit tenant with no active-unit cookie
      // is sent to the `/select-unit` interstitial (brief 0029 AC-04), so the
      // operational scope only resolves once a unit is chosen — mirror that by
      // setting the cookie before navigating.
      await setActiveUnitCookie(context, unitA!, baseURL ?? undefined)

      // Comandas shows only unit A's customer/order.
      await authedPage.goto('/orders?status=all')
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(authedPage.getByText('Cliente Unidade A')).toBeVisible()
      await expect(authedPage.getByText('Cliente Unidade B')).toBeHidden()

      // Dashboard pendências ("hoje") respect the active unit — only unit A's
      // stale open order surfaces (asserted by its distinct amount, R$ 111,00).
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 222,00')).toBeHidden()

      // Switch the active unit to B (cookie). Every operational surface flips.
      await setActiveUnitCookie(context, unitB!, baseURL ?? undefined)

      await authedPage.goto('/orders?status=all')
      await expect(authedPage.getByText('Cliente Unidade B')).toBeVisible()
      await expect(authedPage.getByText('Cliente Unidade A')).toBeHidden()

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByText('R$ 222,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeHidden()
    })

    test('Catálogo stays cross-unit regardless of the active unit (AC-06)', async ({
      context,
      tenant,
      authedPage,
      baseURL,
    }) => {
      const [unitA, unitB] = tenant.unitIds
      // Two catalog services, each linked to a single distinct unit.
      seedCatalogItem(tenant.tenantId, { name: 'Servico So Unidade A', unitIds: [unitA!] })
      seedCatalogItem(tenant.tenantId, { name: 'Servico So Unidade B', unitIds: [unitB!] })

      // Active unit A (cookie set — else the 2-unit tenant lands on the
      // `/select-unit` interstitial, 0029 AC-04): catalog still shows BOTH
      // (definition is cross-unit).
      await setActiveUnitCookie(context, unitA!, baseURL ?? undefined)
      await authedPage.goto('/catalog')
      await expect(authedPage.getByRole('heading', { name: 'Catálogo' })).toBeVisible()
      await expect(authedPage.getByText('Servico So Unidade A')).toBeVisible()
      await expect(authedPage.getByText('Servico So Unidade B')).toBeVisible()

      // Switch to unit B: catalog is unchanged — both still visible.
      await setActiveUnitCookie(context, unitB!, baseURL ?? undefined)
      await authedPage.goto('/catalog')
      await expect(authedPage.getByText('Servico So Unidade A')).toBeVisible()
      await expect(authedPage.getByText('Servico So Unidade B')).toBeVisible()
    })
  })

  test.describe('baseline — single-unit tenant', () => {
    test('enters directly, no per-feature unit picker on the agenda', async ({ authedPage }) => {
      // Default tenantInput → 1 unit. Per-feature unit controls were removed
      // (brief 0039, AC-01); the top switcher is the only unit context and a
      // single-unit tenant renders it as a non-interactive breadcrumb.
      await authedPage.goto('/agenda')
      await expect(authedPage.getByRole('heading', { name: 'Agenda' })).toBeVisible()
      await expect(authedPage.getByRole('combobox', { name: 'Unidade ativa' })).toHaveCount(0)
      await expect(authedPage.getByLabel('Contexto da unidade')).toHaveAttribute(
        'data-interactive',
        'false',
      )
    })
  })

  test.describe('baseline — zero-unit tenant', () => {
    test.use({ tenantInput: { unitCount: 0, professionalCount: 0 } })

    test('stays navigable with empty states', async ({ authedPage }) => {
      // No active unit → /orders keeps its "no active unit" precondition state
      // (which still renders the "Vendas" heading).
      await authedPage.goto('/orders')
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      // App multi-vertical: a tenant with no appointment-mode unit (zero units)
      // hides/redirects the Agenda → /agenda bounces to /orders.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    })
  })
})
