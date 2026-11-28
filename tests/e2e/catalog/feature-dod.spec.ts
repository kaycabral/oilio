import { SubscriptionPlanConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { fillCatalogName } from '../helpers/forms'
import { expectNotFound } from '../helpers/not-found'
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

    await authedPage.goto('/catalog/new')
    await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
    const kindGroup = authedPage.getByRole('radiogroup', { name: 'Tipo do item' })
    await kindGroup.getByRole('radio', { name: 'Serviço' }).click()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toBeVisible()
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('50,00')
    await fillCatalogName(authedPage, svc)
    const criarSvc = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarSvc).toBeEnabled()
    await criarSvc.click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    await authedPage.goto('/catalog/new')
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', { name: 'Produto' })
      .click()
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toHaveCount(0)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('19,90')
    await authedPage.locator('input[name="stock"]').fill('5')
    await fillCatalogName(authedPage, prod)
    const criarProd = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarProd).toBeEnabled()
    await criarProd.click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    await expect(authedPage.getByText(svc, { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText(prod, { exact: true })).toBeVisible()

    await expectNotFound(authedPage, '/services')
    await expectNotFound(authedPage, '/products')
  })

  test('Cenário 2: categoria como entidade + escopo de plano por FK', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const categoryName = `Cabelo ${ts}`
    const categoryId = await seedCategory(org.orgId, { name: categoryName })
    const itemName = `Corte Cat ${ts}`

    await authedPage.goto('/catalog/new')
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', {
        name: 'Serviço',
      })
      .click()
    await chooseOption(authedPage, 'Categoria', categoryName)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('40,00')
    await fillCatalogName(authedPage, itemName)
    const criarItem = authedPage.getByRole('button', { name: 'Criar' })
    await expect(criarItem).toBeEnabled()
    await criarItem.click()
    await expect(authedPage).toHaveURL(/\/catalog$/)
    await expect(authedPage.getByText(itemName, { exact: true })).toBeVisible({ timeout: 5000 })

    const created = await readCatalogItemByNameForAssert(org.orgId, itemName)
    expect(created?.categoryId).toBe(categoryId)

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

  if (!skipOnPostgres())
    test('Cenário 3: consumidores operam sobre o item unificado (comanda + público)', async ({
      org,
      authedPage,
      page,
    }) => {
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

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: new RegExp(customerName) }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await addCatalogItemToOrder(authedPage, 'Pomada Cons')

      await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()
      await choosePaymentMethod(authedPage, 'pix')
      await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
      const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
      await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
      await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoCatalog()
      await expect(booking.serviceCard('Corte Cons')).toBeVisible()
    })
})
