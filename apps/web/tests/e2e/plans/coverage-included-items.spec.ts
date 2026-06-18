// Baseline E2E (#17 / lyra _shared/min-test-coverage.md) for brief 0024 (#1008)
// — plan coverage by granular items (`includedItemIds`) via the real item
// picker on the plan form, alongside the category-convenience selector.
//
// Drives the REAL UI: render+empty (form opens with no coverage) · create a
// plan selecting a service + a product item via the picker → reflects in
// listing + persists (re-open shows the checked items) · edit coverage ·
// delete · degenerate (category-convenience coverage but no item in it yet).

import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCatalogItem, seedCategory } from '../helpers/session'

test.describe('Plans — coverage by granular items (#1008)', { tag: '@critical' }, () => {
  test('render + empty: plan form opens with no coverage selected', async ({ org, authedPage }) => {
    seedCatalogItem(org.orgId, { kind: 'service', name: `Corte ${Date.now()}` })

    await authedPage.goto('/plans/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo plano' })).toBeVisible()
    // Coverage fieldsets render; nothing is pre-checked on a fresh plan.
    const itemsFieldset = authedPage.getByRole('group', { name: 'Itens inclusos', exact: true })
    await expect(itemsFieldset).toBeVisible()
    for (const cb of await itemsFieldset.locator('input[type="checkbox"]').all()) {
      await expect(cb).not.toBeChecked()
    }
  })

  test('create selecting items (service + product) → listing + persists; edit; delete', async ({
    org,
    authedPage,
  }) => {
    authedPage.on('dialog', (d) => d.accept())
    const ts = Date.now().toString()
    const serviceName = `Barba ${ts}`
    const productName = `Pomada ${ts}`
    seedCatalogItem(org.orgId, { kind: 'service', name: serviceName })
    seedCatalogItem(org.orgId, { kind: 'product', name: productName })
    const name = `Plano Itens ${ts}`
    // Coverage checkboxes are labeled by the item name + kind suffix
    // ("<name> (Serviço)" / "<name> (Produto)"); anchor on the unique name.
    const serviceItem = authedPage.getByRole('checkbox', { name: new RegExp(serviceName) })
    const productItem = authedPage.getByRole('checkbox', { name: new RegExp(productName) })

    // ── Create selecting one service + one product via the real picker ──
    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('120,00')
    await authedPage.locator('input[name="limitQuantity"]').fill('4')
    await serviceItem.check()
    await productItem.check()
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()

    // Reflects in listing.
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    // Persists: re-open the editor — both items stay checked (coverage flowed
    // through the domain event + projection, not lost).
    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/plans\/.+/)
    await expect(serviceItem).toBeChecked()
    await expect(productItem).toBeChecked()

    // ── Edit coverage: drop the product, keep the service ──
    await productItem.uncheck()
    await authedPage.locator('form').getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(serviceItem).toBeChecked()
    await expect(productItem).not.toBeChecked()

    // ── Delete (shared AlertDialog, brief 0033 AC-05) ──
    await authedPage.goto('/plans')
    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })

  test('degenerate: category-convenience coverage with no item yet in that category', async ({
    org,
    authedPage,
  }) => {
    authedPage.on('dialog', (d) => d.accept())
    const ts = Date.now().toString()
    // An empty category — no catalog item carries it yet.
    const categoryName = `Vazia ${ts}`
    seedCategory(org.orgId, { name: categoryName })
    const name = `Plano Conveniência ${ts}`
    const categoryItem = authedPage.getByRole('checkbox', { name: categoryName })

    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('80,00')
    await authedPage.locator('input[name="limitQuantity"]').fill('2')
    // Select ONLY the convenience category — no items.
    await categoryItem.check()
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()

    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    // Persists: category checked, no item checked.
    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(categoryItem).toBeChecked()
    const itemsFieldset = authedPage.getByRole('group', { name: 'Itens inclusos', exact: true })
    for (const cb of await itemsFieldset.locator('input[type="checkbox"]').all()) {
      await expect(cb).not.toBeChecked()
    }
  })
})
