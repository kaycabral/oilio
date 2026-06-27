// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md) para a UI
// unificada do catálogo (brief 0023, AC-09 — #1005). Substitui os baselines de
// /services e /products: dirige o FLUXO REAL da /catalog (não seed+assert).
//
// COBERTURA:
// - render + empty state da /catalog vazia.
// - criar um SERVIÇO e um PRODUTO pelo MESMO fluxo "Novo item", trocando o
//   tipo pelo seletor inline (Serviço | Produto) na mesma tela (AC-09).
// - /services e /products não resolvem mais (rotas deletadas, AC-10).
// - filtrar por kind (serviço/produto) e por categoria.
// - editar e excluir um item pelo fluxo da UI.
// - dado degenerado: item com categoryId null renderiza ("Sem categoria").

import { expect, test } from '../fixtures'
import { fillCatalogName } from '../helpers/forms'
import { listItem, rowAction, rowActionsTrigger } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import { seedCatalogItem, seedCategory } from '../helpers/session'

test.describe('Catálogo unificado — UI (#1005)', () => {
  // No professionals: the operational fixture seed now links a catalog service to
  // each operational pro (brief 0068 D3/D4), which would defeat the empty-catalog
  // assertion. These catalog tests need no professional, so seed none.
  test.use({ orgInput: { unitCount: 1, professionalCount: 0 } })

  test('render + empty state', async ({ authedPage }) => {
    // No catalog items → protagonist empty-state (brief 0034 / #1073): the
    // EmptyState takes over with its single CTA; the header + filters are hidden.
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

    // Uma categoria pra exercitar o picker (FK do #1003) + o filtro por categoria.
    const categoryName = `Cabelo ${ts}`
    const categoryId = await seedCategory(org.orgId, { name: categoryName })

    // ── criar SERVIÇO pelo fluxo único "Novo item" (AC-09) ────────────────
    // Tela única "Novo item": o tipo é escolhido inline (Serviço | Produto),
    // não por rota. Sem `?kind=` — o seletor inline define o tipo.
    await authedPage.goto('/catalog/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
    // Seletor inline de tipo dentro do fieldset "Tipo do item".
    const kindGroup = authedPage.getByRole('radiogroup', { name: 'Tipo do item' })
    await expect(kindGroup).toBeVisible()
    // Escolhe Serviço inline → campo de duração aparece na mesma tela.
    await kindGroup.getByRole('radio', { name: 'Serviço' }).click()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toBeVisible()
    await expect(authedPage.locator('input[name="stock"]')).toHaveCount(0)
    // Required fields first, name (combobox) last — see fillCatalogName.
    await chooseOption(authedPage, 'Categoria', categoryName)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('50,00')
    await fillCatalogName(authedPage, svcName)
    const criarSvc = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarSvc).toBeEnabled()
    await criarSvc.click()
    // Client-side redirect after the server action resolves (router.push on
    // success). `waitForURL` auto-waits on the navigation — idiomatic, no custom
    // timeout (the earlier flake was a raced combobox leaving the name empty, now
    // fixed at the fill site, not a genuinely slow redirect).
    await authedPage.waitForURL(/\/catalog$/)
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()

    // ── criar PRODUTO pelo MESMO fluxo, trocando o tipo inline (AC-09) ────
    await authedPage.goto('/catalog/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
    // Troca pra Produto inline → campo de estoque aparece, duração some.
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', { name: 'Produto' })
      .click()
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toHaveCount(0)
    // Required fields first, name (combobox) last — see fillCatalogName.
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('19,90')
    await authedPage.locator('input[name="stock"]').fill('5')
    await fillCatalogName(authedPage, prodName)
    const criarProd = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarProd).toBeEnabled()
    await criarProd.click()
    await authedPage.waitForURL(/\/catalog$/)
    await expect(authedPage.getByText(prodName, { exact: true })).toBeVisible()

    // ── ambos listados sem filtro ─────────────────────────────────────────
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(prodName, { exact: true })).toBeVisible()

    // ── filtrar por kind = produto ────────────────────────────────────────
    await chooseOption(authedPage, 'Tipo', 'Produtos')
    await expect(authedPage).toHaveURL(/kind=product/)
    await expect(authedPage.getByText(prodName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(svcName, { exact: true })).toBeHidden()

    // ── filtrar por kind = serviço ────────────────────────────────────────
    await chooseOption(authedPage, 'Tipo', 'Serviços')
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(prodName, { exact: true })).toBeHidden()

    // ── filtrar por categoria (só o serviço tem categoria) ────────────────
    await chooseOption(authedPage, 'Tipo', 'Todos')
    await chooseOption(authedPage, 'Categoria', categoryName)
    await expect(authedPage).toHaveURL(new RegExp(`categoryId=${categoryId}`))
    await expect(authedPage.getByText(svcName, { exact: true })).toBeVisible()
    await expect(authedPage.getByText(prodName, { exact: true })).toBeHidden()

    // limpa o filtro de categoria pra editar o serviço.
    await chooseOption(authedPage, 'Categoria', 'Todas')

    // ── editar o serviço pela UI ──────────────────────────────────────────
    await rowAction(authedPage, new RegExp(svcName), 'Editar')
    await expect(authedPage).toHaveURL(/\/catalog\/.+/)
    // Combobox-safe fill (asserts the value landed) so the edited name can't come
    // back empty and block Salvar — same race as the create flows.
    await fillCatalogName(authedPage, svcEdited)
    const salvar = authedPage.locator('form').getByRole('button', { name: 'Salvar' })
    await expect(salvar).toBeEnabled()
    await salvar.click()
    await authedPage.waitForURL(/\/catalog$/)
    await expect(authedPage.getByText(svcEdited, { exact: true })).toBeVisible()

    // ── excluir o serviço editado (shared AlertDialog, brief 0033 AC-05) ────
    const svcRow = listItem(authedPage, new RegExp(ts)).filter({ hasText: svcEdited })
    await rowActionsTrigger(svcRow).click()
    await authedPage.getByRole('menuitem', { name: 'Excluir' }).click()
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(svcRow).toBeHidden({ timeout: 5000 })
  })

  test('/services e /products não resolvem mais (rotas deletadas, AC-10)', async ({
    authedPage,
  }) => {
    // Pré-prod: rotas removidas por completo, sem redirect. As páginas legadas
    // não existem mais → Next responde 404 (not-found), nunca um redirect pro
    // catálogo. /catalog é o único ponto de gestão.
    for (const path of ['/services', '/products', '/services/new', '/products/new']) {
      const res = await authedPage.goto(path)
      expect(res?.status(), `${path} deve responder 404`).toBe(404)
      // Não foi redirecionado pro catálogo — a URL permanece na rota morta.
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
    // categoria ausente: o item ainda renderiza na lista (sem categoria, a
    // descrição cai pro detalhe de estoque; o `List` não expõe célula de
    // categoria vazia, então a prova é o row renderizar).
    await expect(listItem(authedPage, new RegExp(name))).toBeVisible()
  })
})
