// Consumer migration E2E (brief 0023, #1004). Proves the agenda/booking, order
// close (mixed service + product), and public catalog surfaces now resolve
// against the unified `catalog_items` collection — no regression vs the legacy
// `services`/`products` split.
//
// The `seedService`/`seedProduct` helpers mirror each legacy doc into a
// kind-discriminated `catalog_items` doc with the SAME id (see helpers/session
// — consumer migration). So booking/order/public flows resolve the returned id
// against the unified model exactly as production will after #1005 converges
// the CRUD UI onto the same collection.

import { expect, test } from '../fixtures'
import type { FsValue } from '../helpers/firestore-rest'
import { intStrField, strField } from '../helpers/firestore-rest'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, chooseOptionByIndex, choosePaymentMethod } from '../helpers/select'
import {
  listAppointmentIds,
  readAppointment,
  readCatalogItem,
  seedAppointment,
  seedCategory,
  seedCustomer,
  seedProduct,
  seedService,
  seedSubscription,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

const fieldStr = (fields: Record<string, FsValue> | null, key: string): string | null =>
  strField(fields ?? undefined, key) ?? null
const fieldInt = (fields: Record<string, FsValue> | null, key: string): string | null =>
  intStrField(fields ?? undefined, key) ?? null

test.describe('Consumidores no item unificado (#1004)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  // AC-06: booking via agenda referencia um CatalogItem kind service e congela
  // os snapshots (preço/duração/comissão) no commit.
  test('AC-06 — agenda books a catalog service and freezes the snapshot', async ({
    org,
    authedPage,
  }) => {
    const serviceId = seedService(org.orgId, {
      name: 'Corte Unificado',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 40 },
      unitIds: org.unitIds,
    })
    // The returned id resolves as a kind-service catalog item.
    expect(fieldStr(readCatalogItem(org.orgId, serviceId), 'kind')).toBe('service')

    const customerName = `Cliente Unificado ${Date.now()}`
    seedCustomer(org.orgId, { name: customerName, whatsapp: '11955551111' })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    const dialog = await agenda.openNewAppointmentDialog()
    await expect(dialog).toBeVisible()

    await chooseOption(dialog, 'Serviço', 'Corte Unificado')
    await chooseOptionByIndex(dialog, 'Profissional', 0)
    await chooseOption(dialog, 'Cliente', customerName)
    await dialog.locator('input[name="date"]').fill('2026-08-12')
    await dialog.locator('input[name="startTime"]').fill('10:00')
    await dialog.getByRole('button', { name: /^Agendar$/ }).click()

    // Dialog closes on success.
    await expect(dialog).toBeHidden()

    // Assert the appointment references the catalog service id + froze snapshots.
    const apptId = listAppointmentIds(org.orgId)[0]
    expect(apptId).toBeTruthy()
    const appt = readAppointment(org.orgId, apptId!)
    expect(fieldStr(appt, 'serviceId')).toBe(serviceId)
    expect(fieldInt(appt, 'servicePriceCentsSnapshot')).toBe('5000')
    expect(fieldInt(appt, 'serviceDurationMinutesSnapshot')).toBe('30')
    const commission = appt?.commissionSnapshot
    expect(fieldStr(commission?.mapValue?.fields ?? null, 'kind')).toBe('percentage')
  })

  // AC-06 (semantic that slice 2 left open): plano com includedCategoryIds
  // restrito bloqueia booking de serviço fora da categoria coberta.
  test('AC-06 — category-restricted plan blocks a service outside its coverage', async ({
    org,
    authedPage,
  }) => {
    const coveredCat = seedCategory(org.orgId, { name: 'Cabelo' })
    // Service whose category is NOT in the plan's includedCategoryIds.
    seedService(org.orgId, {
      name: 'Estetica Fora',
      durationMinutes: 30,
      priceCents: 5000,
      category: 'cat-estetica-uncovered',
      unitIds: org.unitIds,
    })

    const customerName = `Plano Categoria ${Date.now()}`
    const customerId = seedCustomer(org.orgId, {
      name: customerName,
      whatsapp: '11955552222',
    })
    seedSubscription(org.orgId, customerId, { includedCategoryIds: [coveredCat] })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-13')
    const dialog = await agenda.openNewAppointmentDialog()

    await chooseOption(dialog, 'Serviço', 'Estetica Fora')
    await chooseOptionByIndex(dialog, 'Profissional', 0)
    await chooseOption(dialog, 'Cliente', customerName)
    await dialog.locator('input[name="date"]').fill('2026-08-13')
    await dialog.locator('input[name="startTime"]').fill('10:00')
    await dialog.getByRole('button', { name: /^Agendar$/ }).click()

    await expect(dialog.getByText(/fora das categorias cobertas pelo plano/i)).toBeVisible()
  })

  // AC-07 + AC-06: comanda mista (serviço + produto) fecha resolvendo ambos
  // contra catalog_items e gera comissão do serviço.
  test('AC-07 — closing a comanda with service + product resolves both kinds', async ({
    org,
    authedPage,
  }) => {
    const serviceId = seedService(org.orgId, {
      name: 'Corte Comanda',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 50 },
      unitIds: org.unitIds,
    })
    seedProduct(org.orgId, { name: 'Pomada Comanda', priceCents: 3000 })
    const customerId = seedCustomer(org.orgId, {
      name: 'Cliente Comanda',
      whatsapp: '11955553333',
    })
    // Seed a scheduled appointment so "Iniciar atendimento" opens the order.
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

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Comanda/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // Service item pre-populated from the catalog (R$ 50).
    await expect(authedPage.getByText('Corte Comanda').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

    // Add the product via the single "Adicionar item" (#1005, AC-11) — kind is
    // inferred from the chosen catalog item (resolved from catalog_items).
    await addCatalogItemToOrder(authedPage, 'Pomada Comanda')
    await expect(authedPage.getByText('Pomada Comanda', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()

    // Close with PIX → commission generated from the service (50% of R$ 50).
    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const confirmDialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(authedPage.getByText(/comiss(ão|ões)/i).first()).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
  })

  // AC-08: catálogo público lê catalog_items kind service e renderiza serviços
  // públicos na landing.
  test('AC-08 — public landing renders public catalog services from catalog_items', async ({
    org,
    page,
  }) => {
    seedService(org.orgId, {
      name: 'Corte Publico',
      priceCents: 6500,
      publicVisible: true,
      unitIds: [org.unitIds[0]!],
    })
    // Internal-only service must NOT leak to the public catalog.
    seedService(org.orgId, {
      name: 'Corte Interno',
      priceCents: 4000,
      publicVisible: false,
      unitIds: [org.unitIds[0]!],
    })

    const booking = new PublicBookingPage(page, orgSlug(org.orgId))
    await booking.gotoCatalog()
    await expect(booking.serviceCard('Corte Publico')).toBeVisible()
    await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
    await expect(page.getByText('Corte Interno')).toHaveCount(0)
  })
})
