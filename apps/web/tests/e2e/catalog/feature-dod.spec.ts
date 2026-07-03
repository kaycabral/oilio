// Feature-level E2E — brief 0023 § Definition of Done (parent #1001).
//
// 1 test por cenário do DoD, validando o contrato da feature "Catálogo
// unificado" como gate do parent — escopo cross-component, não das sub-issues
// isoladas (#1002 modelo · #1003 Category · #1004 consumidores · #1005 UI):
// - Cenário 1: item unificado criado e listado, numa tela só (seletor inline) [critical]
// - Cenário 2: categoria como entidade + escopo de plano por FK [critical]
// - Cenário 3: consumidores operam sobre o item unificado (comanda + público) [critical]
//
// Reflete o reescopo de UX 2026-06-01 (tela única, seletor inline, sem rota por
// kind, comanda com um "Adicionar item"). Roda contra emulator + build.

import { SubscriptionPlanConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { fillCatalogName } from '../helpers/forms'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  pgReadProjection,
  readCatalogItem,
  readCatalogItemByNameForAssert,
  seedAppointment,
  seedCategory,
  seedCustomer,
  seedProduct,
  seedService,
  seedSubscriptionPlan,
  skipOnPostgres,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

// `included_category_ids` is a JSONB column (the projector stores
// `JSON.stringify(plan.includedCategoryIds)`); pg returns it parsed as an array
// of strings. Decode it strictly so the FK-array assert stays typed.
const IncludedCategoryIds = Schema.decodeUnknownSync(Schema.Array(Schema.String))

test.describe('Feature 0023 — Definition of Done (catálogo unificado)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: item unificado criado e listado, numa tela só (seletor inline)', async ({
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const svc = `Serviço DoD ${ts}`
    const prod = `Produto DoD ${ts}`

    // Serviço e produto nascem do MESMO fluxo "Novo item", trocando o tipo pelo
    // seletor inline — sem rota por kind (AC-09).
    await authedPage.goto('/catalog/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
    const kindGroup = authedPage.getByRole('radiogroup', { name: 'Tipo do item' })
    await kindGroup.getByRole('radio', { name: 'Serviço' }).click()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toBeVisible()
    // Required fields first, name (combobox) last — see fillCatalogName.
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('50,00')
    await fillCatalogName(authedPage, svc)
    // The submit button is gated by client-side form validity; wait for it to
    // enable before clicking (a click while disabled is a no-op → no redirect).
    const criarSvc = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarSvc).toBeEnabled()
    await criarSvc.click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    await authedPage.goto('/catalog/new')
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', { name: 'Produto' })
      .click()
    // Produto revela estoque e esconde duração — mesma tela.
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toHaveCount(0)
    // Required fields first, name (combobox) last — see fillCatalogName.
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('19,90')
    await authedPage.locator('input[name="stock"]').fill('5')
    await fillCatalogName(authedPage, prod)
    const criarProd = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarProd).toBeEnabled()
    await criarProd.click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    // Ambos vivem na mesma listagem unificada.
    await expect(authedPage.getByText(svc, { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText(prod, { exact: true })).toBeVisible()

    // E as rotas antigas não existem mais (AC-10).
    expect((await authedPage.goto('/services'))?.status()).toBe(404)
    expect((await authedPage.goto('/products'))?.status()).toBe(404)
  })

  test('Cenário 2: categoria como entidade + escopo de plano por FK', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const categoryName = `Cabelo ${ts}`
    const categoryId = await seedCategory(org.orgId, { name: categoryName })
    const itemName = `Corte Cat ${ts}`

    // Item criado pela UI associa a categoria pelo PICKER (FK do #1003), não string.
    await authedPage.goto('/catalog/new')
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', {
        name: 'Serviço',
      })
      .click()
    // O picker de categoria lista a entidade cadastrada.
    await chooseOption(authedPage, 'Categoria', categoryName)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('40,00')
    // Nome (combobox) por último — ver fillCatalogName.
    await fillCatalogName(authedPage, itemName)
    const criarItem = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarItem).toBeEnabled()
    await criarItem.click()
    await expect(authedPage).toHaveURL(/\/catalog$/)
    await expect(authedPage.getByText(itemName, { exact: true })).toBeVisible({ timeout: 5000 })

    // O item criado carrega categoryId por FK (não string solta). Lê do backend
    // ativo (Firestore emulator ou tabela tipada Postgres) — backend-aware.
    const created = await readCatalogItemByNameForAssert(org.orgId, itemName)
    expect(created?.categoryId).toBe(categoryId)

    // O escopo do plano referencia o MESMO categoryId, íntegro (FK array).
    const planId = await seedSubscriptionPlan(org.orgId, {
      name: `Plano Cabelo ${ts}`,
      includedCategoryIds: [categoryId],
    })
    const plan = await pgReadProjection(
      'subscription_plans',
      aggregateRef(SubscriptionPlanConfig, org.orgId, planId),
    )
    const included = IncludedCategoryIds(plan?.included_category_ids)
    expect(included).toContain(categoryId)
  })

  // Consome o item via comanda + público — o read-path do aggregate `order` (e o
  // bundle público) migra na feature E (Onda 3), não no piloto catalog-item.
  // Coberto no backend Firestore; Postgres entra com a feature E. Registro
  // condicional (o repo bane `test.skip`).
  if (!skipOnPostgres())
    test('Cenário 3: consumidores operam sobre o item unificado (comanda + público)', async ({
      org,
      authedPage,
      page,
    }) => {
      // Serviço + produto mirroram pra catalog_items (helpers de migração #1004).
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Cons',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        commission: { kind: 'percentage', value: 50 },
        unitIds: org.unitIds,
      })
      await seedProduct(org.orgId, { name: 'Pomada Cons', priceCents: 3000 })
      expect((await readCatalogItem(org.orgId, serviceId))?.kind).toBe('service')

      const customerName = `Cliente Cons ${Date.now()}`
      const customerId = await seedCustomer(org.orgId, {
        name: customerName,
        mobile: uniqueWhatsapp(),
      })
      await seedAppointment({
        orgId: org.orgId,
        unitId: org.unitIds[0]!,
        memberOperationId: org.memberOperationIds[0]!,
        customerId,
        serviceId,
        startAt: '2026-09-08T17:00:00.000Z',
        endAt: '2026-09-08T17:30:00.000Z',
        status: 'scheduled',
        servicePriceCentsSnapshot: 5000,
        serviceDurationMinutesSnapshot: 30,
        commissionSnapshot: { kind: 'percentage', value: 50 },
      })

      // Comanda: abre da agenda (serviço do catálogo) e adiciona o produto pelo
      // ÚNICO "Adicionar item" (AC-11) — kind inferido do item.
      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: new RegExp(customerName) }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await addCatalogItemToOrder(authedPage, 'Pomada Cons')

      // Total = serviço (50) + produto (30) = R$ 80,00; fecha com pix.
      await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()
      await choosePaymentMethod(authedPage, 'pix')
      await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
      const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
      await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
      await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

      // Catálogo público projeta o serviço unificado (kind service, publicVisible).
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoCatalog()
      await expect(booking.serviceCard('Corte Cons')).toBeVisible()
    })
})
