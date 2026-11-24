import { expect, test } from '../fixtures'
import { fillCatalogName } from '../helpers/forms'
import { listItem, rowAction, rowActionsTrigger } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import { seedCatalogItem, seedCategory } from '../helpers/session'

test.describe('Catálogo unificado — UI (#1005)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

  test('render + empty state', async ({ authedPage }) => {
    await authedPage.goto('/catalog')
    await expect(authedPage.getByText(/nenhum item no catálogo/i)).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Cadastrar item' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Catálogo' })).toBeHidden()
  })

  test('criar serviço + produto pela UI → listar → filtrar por kind/categoria → editar → excluir', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const svcName = `Serviço Cat ${ts}`
    const prodName = `Produto Cat ${ts}`
    const svcEdited = `${svcName} Editado`

    const categoryName = `Cabelo ${ts}`
    const categoryId = await seedCategory(org.orgId, { name: categoryName })

    await authedPage.goto('/catalog/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
    const kindGroup = authedPage.getByRole('radiogroup', { name: 'Tipo do item' })
    await expect(kindGroup).toBeVisible()
    await kindGroup.getByRole('radio', { name: 'Serviço' }).click()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toBeVisible()
    await expect(authedPage.locator('input[name="stock"]')).toHaveCount(0)
    await chooseOption(authedPage, 'Categoria', categoryName)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('50,00')
    await fillCatalogName(authedPage, svcName)
    const criarSvc = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarSvc).toBeEnabled()
    await criarSvc.click()
    await authedPage.waitForURL(/\/catalog$/)
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()

    await authedPage.goto('/catalog/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', { name: 'Produto' })
      .click()
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toHaveCount(0)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('19,90')
    await authedPage.locator('input[name="stock"]').fill('5')
    await fillCatalogName(authedPage, prodName)
    const criarProd = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarProd).toBeEnabled()
    await criarProd.click()
    await authedPage.waitForURL(/\/catalog$/)
    await expect(authedPage.getByText(prodName, { exact: true })).toBeVisible()

    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(prodName, { exact: true })).toBeVisible()

    await chooseOption(authedPage, 'Tipo', 'Produtos')
    await expect(authedPage).toHaveURL(/kind=product/)
    await expect(authedPage.getByText(prodName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(svcName, { exact: true })).toBeHidden()

    await chooseOption(authedPage, 'Tipo', 'Serviços')
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(prodName, { exact: true })).toBeHidden()

    await chooseOption(authedPage, 'Tipo', 'Todos')
    await chooseOption(authedPage, 'Categoria', categoryName)
    await expect(authedPage).toHaveURL(new RegExp(`categoryId=${categoryId}`))
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(prodName, { exact: true })).toBeHidden()

    await chooseOption(authedPage, 'Categoria', 'Todas')

    await rowAction(authedPage, new RegExp(svcName), 'Editar')
    await expect(authedPage).toHaveURL(/\/catalog\/.+/)
    await fillCatalogName(authedPage, svcEdited)
    const salvar = authedPage.locator('form').getByRole('button', { name: 'Salvar' })
    await expect(salvar).toBeEnabled()
    await salvar.click()
    await authedPage.waitForURL(/\/catalog$/)
    await expect(authedPage.getByText(svcEdited, { exact: true })).toBeVisible()

    const svcRow = listItem(authedPage, new RegExp(ts)).filter({ hasText: svcEdited })
    await rowActionsTrigger(svcRow).click()
    await authedPage.getByRole('menuitem', { name: 'Excluir' }).click()
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(svcRow).toBeHidden({ timeout: 5000 })
  })

  test('/services e /products não resolvem mais (rotas deletadas, AC-10)', async ({
    authedPage,
  }) => {
    for (const path of ['/services', '/products', '/services/new', '/products/new']) {
      const res = await authedPage.goto(path)
      expect(res?.status(), `${path} deve responder 404`).toBe(404)
      await expect(authedPage).toHaveURL(new RegExp(`${path}$`))
    }
  })

  test('dado degenerado (item com categoryId null) renderiza', async ({ org, authedPage }) => {
    const name = `Item Sem Categoria ${Date.now()}`
    await seedCatalogItem(org.orgId, {
      kind: 'product',
      name,
      categoryId: null,
      commission: null,
      unitIds: org.unitIds,
    })

    await authedPage.goto('/catalog')
    await expect(authedPage.getByRole('heading', { name: 'Catálogo' })).toBeVisible()
    await expect(listItem(authedPage, new RegExp(name))).toBeVisible()
  })
})
