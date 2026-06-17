// E2E for #1073 (brief 0034) — the list-surface migration's filtered-empty
// behavior on the two migrated surfaces that carry filters. The no-data
// protagonist for every surface is owned by each area's baseline.spec.ts
// (render + empty state). This spec proves the harder state: data EXISTS but
// the active filter slice is empty → chrome (header + filters) stays, a
// "no results" body shows, and the create protagonist does NOT take over.
//
// AC-02 [critical] — filtered-empty keeps filters + "nenhum resultado".
// AC-05 [edge]      — coverage across migrated surfaces (sample: catalog, orders).

import { expect, test } from '../fixtures'
import { seedCatalogItem } from '../helpers/session'

test.describe('Migrated surfaces — filtered-empty keeps the filters (#1073)', () => {
  test('catalog: a service exists but the product filter is empty', async ({
    tenant,
    authedPage,
  }) => {
    // Data present (one service) → not a blank catalog. Filtering to products
    // yields 0, but the catalog is NOT empty.
    seedCatalogItem(tenant.tenantId, { kind: 'service', name: `Serviço ${Date.now()}` })

    await authedPage.goto('/catalog?kind=product')

    // Filters + header stay; "no results" body shows; the protagonist (which
    // would hide the header) does NOT take over.
    await expect(authedPage.getByRole('heading', { name: 'Catálogo' })).toBeVisible()
    await expect(authedPage.getByText(/nenhum item para o filtro/i)).toBeVisible()
    await expect(authedPage.getByText(/nenhum item no catálogo/i)).toBeHidden()
  })

  test('orders: an open sale exists but the "Fechadas" tab is empty', async ({ authedPage }) => {
    // Create one (open) sale through the real flow so the unit has data.
    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // The "Fechadas" slice returns 0, but the unit HAS a sale → filtered-empty:
    // the status filter (a Select combobox) stays, "no results" body shows,
    // protagonist stays hidden.
    await authedPage.goto('/orders?status=closed')
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Fechadas')
    await expect(authedPage.getByText(/nenhuma venda para o filtro/i)).toBeVisible()
    await expect(authedPage.getByText('Nenhuma venda registrada')).toBeHidden()
  })
})
