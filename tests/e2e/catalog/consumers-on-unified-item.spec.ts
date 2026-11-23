import { expect, test } from '../fixtures'
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
  skipOnPostgres,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

if (!skipOnPostgres()) {
  test.describe('Consumidores no item unificado (#1004)', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('AC-06 — agenda books a catalog service and freezes the snapshot', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Unificado',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 40 },
        unitIds: org.unitIds,
      })
      expect((await readCatalogItem(org.orgId, serviceId))?.kind).toBe('service')

      const customerName = `Cliente Unificado ${Date.now()}`
      await seedCustomer(org.orgId, { name: customerName, mobile: uniqueWhatsapp() })

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-08-12')
      const dialog = await agenda.openNewAppointmentDialog()
      await expect(dialog).toBeVisible()

      await chooseOption(dialog, 'Serviço', 'Corte Unificado')
      await chooseOptionByIndex(dialog, 'Profissional', 0)
      await chooseOption(dialog, 'Cliente', customerName)
      await dialog.locator('input[name="date"]').fill('2026-08-12')
      await chooseOption(dialog, 'Início', '10:00')
      await dialog.getByRole('button', { name: /^Agendar$/ }).click()

      await expect(dialog).toBeHidden()

      const apptId = (await listAppointmentIds(org.orgId))[0]
      expect(apptId).toBeTruthy()
      const appt = await readAppointment(org.orgId, apptId!)
      expect(appt?.serviceId).toBe(serviceId)
      expect(appt?.servicePriceCentsSnapshot).toBe(5000)
      expect(appt?.serviceDurationMinutesSnapshot).toBe(30)
      expect(appt?.commissionSnapshot?.kind).toBe('percentage')
    })

    test('AC-06 — category-restricted plan blocks a service outside its coverage', async ({
      org,
      authedPage,
    }) => {
      const coveredCat = await seedCategory(org.orgId, { name: 'Cabelo' })
      await seedService(org.orgId, {
        name: 'Estetica Fora',
        durationMinutes: 30,
        priceCents: 5000,
        category: 'cat-estetica-uncovered',
        unitIds: org.unitIds,
      })

      const customerName = `Plano Categoria ${Date.now()}`
      const customerId = await seedCustomer(org.orgId, {
        name: customerName,
        mobile: uniqueWhatsapp(),
      })
      await seedSubscription(org.orgId, customerId, { includedCategoryIds: [coveredCat] })

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-08-13')
      const dialog = await agenda.openNewAppointmentDialog()

      await chooseOption(dialog, 'Serviço', 'Estetica Fora')
      await chooseOptionByIndex(dialog, 'Profissional', 0)
      await chooseOption(dialog, 'Cliente', customerName)
      await dialog.locator('input[name="date"]').fill('2026-08-13')
      await chooseOption(dialog, 'Início', '10:00')
      await dialog.getByRole('button', { name: /^Agendar$/ }).click()

      await expect(dialog.getByText(/fora das categorias cobertas pelo plano/i)).toBeVisible()
    })

    test('AC-07 — closing a comanda with service + product resolves both kinds', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Comanda',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: org.unitIds,
      })
      await seedProduct(org.orgId, { name: 'Pomada Comanda', priceCents: 3000 })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Cliente Comanda',
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
      await authedPage.getByRole('button', { name: /Cliente Comanda/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)

      await expect(authedPage.getByText('Corte Comanda').first()).toBeVisible()
      await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

      await addCatalogItemToOrder(authedPage, 'Pomada Comanda')
      await expect(authedPage.getByText('Pomada Comanda', { exact: true })).toBeVisible()
      await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()

      await choosePaymentMethod(authedPage, 'pix')
      await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
      const confirmDialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
      await expect(confirmDialog).toBeVisible()
      await confirmDialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

      await expect(authedPage.getByText(/comiss(ão|ões)/i).first()).toBeVisible({ timeout: 5000 })
      await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    })

    test('AC-08 — public landing renders public catalog services from catalog_items', async ({
      org,
      page,
    }) => {
      await seedService(org.orgId, {
        name: 'Corte Publico',
        priceCents: 6500,
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })
      await seedService(org.orgId, {
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
}
