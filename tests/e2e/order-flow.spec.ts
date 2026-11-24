import { expect, test } from './fixtures'
import { addCatalogItemToOrder } from './helpers/orders'
import { choosePaymentMethod } from './helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from './helpers/session'
import { AgendaPage } from './pages'

async function seedAttendanceFixture(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  await seedProduct(org.orgId, { name: 'Pomada', priceCents: 3000 })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Order',
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
}

test.describe('Order — caminho feliz', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('início do agendamento → adiciona produto → fecha → comissão gerada', async ({
    org,
    authedPage,
  }) => {
    await seedAttendanceFixture(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Order/ }).click()
    await expect(authedPage.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible()

    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Order' })).toBeVisible()

    await expect(authedPage.getByText('Corte').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

    await addCatalogItemToOrder(authedPage, 'Pomada')

    await expect(authedPage.getByText('Pomada', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const confirmDialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(authedPage.getByText(/comiss(ão|ões)/i).first()).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    await expect(authedPage.getByText(/PIX/)).toBeVisible()
  })

  test('iniciar atendimento é idempotente: segundo clique reabre a mesma order', async ({
    org,
    authedPage,
  }) => {
    await seedAttendanceFixture(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Order/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/(.+)/)
    const firstUrl = authedPage.url()

    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Order/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

    await expect(authedPage).toHaveURL(firstUrl)
  })
})
