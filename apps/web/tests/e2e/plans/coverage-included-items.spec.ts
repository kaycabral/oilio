import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCatalogItem, seedCategory } from '../helpers/session'

test.describe('Plans — coverage by granular items (#1008)', { tag: '@critical' }, () => {
  test('render + empty: plan form opens with no coverage selected', async ({ org, authedPage }) => {
    await seedCatalogItem(org.orgId, { kind: 'service', name: `Corte ${Date.now()}` })

    await authedPage.goto('/plans/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo plano' })).toBeVisible()
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
    await seedCatalogItem(org.orgId, { kind: 'service', name: serviceName })
    await seedCatalogItem(org.orgId, { kind: 'product', name: productName })
    const name = `Plano Itens ${ts}`
    const serviceItem = authedPage.getByRole('checkbox', { name: new RegExp(serviceName) })
    const productItem = authedPage.getByRole('checkbox', { name: new RegExp(productName) })

    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('120,00')
    await authedPage.locator('input[name="limitQuantity"]').fill('4')
    await serviceItem.check()
    await productItem.check()
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()

    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/plans\/.+/)
    await expect(serviceItem).toBeChecked()
    await expect(productItem).toBeChecked()

    await productItem.uncheck()
    await authedPage.locator('form').getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(serviceItem).toBeChecked()
    await expect(productItem).not.toBeChecked()

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
    const categoryName = `Vazia ${ts}`
    await seedCategory(org.orgId, { name: categoryName })
    const name = `Plano Conveniência ${ts}`
    const categoryItem = authedPage.getByRole('checkbox', { name: categoryName })

    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('80,00')
    await authedPage.locator('input[name="limitQuantity"]').fill('2')
    await categoryItem.check()
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()

    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(categoryItem).toBeChecked()
    const itemsFieldset = authedPage.getByRole('group', { name: 'Itens inclusos', exact: true })
    for (const cb of await itemsFieldset.locator('input[type="checkbox"]').all()) {
      await expect(cb).not.toBeChecked()
    }
  })
})
