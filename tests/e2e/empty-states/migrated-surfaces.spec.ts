import { expect, test } from '../fixtures'
import { seedCatalogItem } from '../helpers/session'

test.describe('Migrated surfaces — filtered-empty keeps the filters (#1073)', () => {
  test('catalog: a service exists but the product filter is empty', async ({ org, authedPage }) => {
    await seedCatalogItem(org.orgId, { kind: 'service', name: `Serviço ${Date.now()}` })

    await authedPage.goto('/catalog?kind=product')

    await expect(authedPage.getByRole('heading', { name: 'Catálogo' })).toBeVisible()
    await expect(authedPage.getByText(/nenhum item para o filtro/i)).toBeVisible()
    await expect(authedPage.getByText(/nenhum item no catálogo/i)).toBeHidden()
  })

  test('orders: an open sale exists but the "Fechadas" tab is empty', async ({ authedPage }) => {
    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await authedPage.goto('/orders?status=closed')
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Fechadas')
    await expect(authedPage.getByText(/nenhuma venda para o filtro/i)).toBeVisible()
    await expect(authedPage.getByText('Nenhuma venda registrada')).toBeHidden()
  })
})
