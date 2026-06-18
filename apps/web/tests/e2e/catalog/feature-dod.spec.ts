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

import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsValue } from '../helpers/firestore-rest'
import {
  decodeFsFieldsDoc,
  decodeFsListResponse,
  parseJson,
  strField,
} from '../helpers/firestore-rest'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  readCatalogItem,
  seedAppointment,
  seedCategory,
  seedCustomer,
  seedProduct,
  seedService,
  seedSubscriptionPlan,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

function readDoc(orgId: string, path: string): Record<string, FsValue> | null {
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgs/${orgId}/${path}`
  const out = execFileSync('curl', ['-fsS', url, '-H', 'Authorization: Bearer owner'], {
    encoding: 'utf8',
  })
  return parseJson(out, decodeFsFieldsDoc).fields ?? null
}

test.describe('Feature 0023 — Definition of Done (catálogo unificado)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
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
    await authedPage.locator('input[name="name"]').fill(svc)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('50,00')
    await authedPage.getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    await authedPage.goto('/catalog/new')
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', { name: 'Produto' })
      .click()
    // Produto revela estoque e esconde duração — mesma tela.
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible()
    await expect(authedPage.locator('input[name="durationMinutes"]')).toHaveCount(0)
    await authedPage.locator('input[name="name"]').fill(prod)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('19,90')
    await authedPage.locator('input[name="stock"]').fill('5')
    await authedPage.getByRole('button', { name: 'Criar' }).click()
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
    const categoryId = seedCategory(org.orgId, { name: categoryName })
    const itemName = `Corte Cat ${ts}`

    // Item criado pela UI associa a categoria pelo PICKER (FK do #1003), não string.
    await authedPage.goto('/catalog/new')
    await authedPage
      .getByRole('radiogroup', { name: 'Tipo do item' })
      .getByRole('radio', {
        name: 'Serviço',
      })
      .click()
    await authedPage.locator('input[name="name"]').fill(itemName)
    // O picker de categoria lista a entidade cadastrada.
    await chooseOption(authedPage, 'Categoria', categoryName)
    await authedPage.locator('input[name="unitIds"]').first().check()
    await authedPage.locator('input[name="priceCents"]').fill('40,00')
    await authedPage.getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/catalog$/)
    await expect(authedPage.getByText(itemName, { exact: true })).toBeVisible({ timeout: 5000 })

    // O item criado carrega categoryId por FK (não string solta).
    const items = parseJson(
      execFileSync(
        'curl',
        [
          '-fsS',
          `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgs/${org.orgId}/catalog_items`,
          '-H',
          'Authorization: Bearer owner',
        ],
        { encoding: 'utf8' },
      ),
      decodeFsListResponse,
    )
    const created = (items.documents ?? []).find((d) => strField(d.fields, 'name') === itemName)
    expect(strField(created?.fields, 'categoryId')).toBe(categoryId)

    // O escopo do plano referencia o MESMO categoryId, íntegro (FK array).
    const planId = seedSubscriptionPlan(org.orgId, {
      name: `Plano Cabelo ${ts}`,
      includedCategoryIds: [categoryId],
    })
    const plan = readDoc(org.orgId, `subscription_plans/${planId}`)
    const included = plan?.includedCategoryIds?.arrayValue?.values?.map((v) => v.stringValue)
    expect(included).toContain(categoryId)
  })

  test('Cenário 3: consumidores operam sobre o item unificado (comanda + público)', async ({
    org,
    authedPage,
    page,
  }) => {
    // Serviço + produto mirroram pra catalog_items (helpers de migração #1004).
    const serviceId = seedService(org.orgId, {
      name: 'Corte Cons',
      durationMinutes: 30,
      priceCents: 5000,
      publicVisible: true,
      commission: { kind: 'percentage', value: 50 },
      unitIds: org.unitIds,
    })
    seedProduct(org.orgId, { name: 'Pomada Cons', priceCents: 3000 })
    expect(strField(readCatalogItem(org.orgId, serviceId) ?? undefined, 'kind')).toBe('service')

    const customerName = `Cliente Cons ${Date.now()}`
    const customerId = seedCustomer(org.orgId, {
      name: customerName,
      whatsapp: '11955552222',
    })
    seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: org.professionalIds[0]!,
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
