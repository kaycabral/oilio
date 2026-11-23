import { expect, test } from './fixtures'
import { choosePaymentMethod } from './helpers/select'
import {
  patchAppointmentSnapshot,
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
} from './helpers/session'
import { AgendaPage, ServicesPage } from './pages'

test.describe('Snapshot do agendamento', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('order iniciada de Agendamento usa preço do snapshot, não do Serviço vivo', async ({
    org,
    authedPage,
  }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      unitIds: org.unitIds,
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Snapshot',
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
      commissionSnapshot: null,
    })

    const services = new ServicesPage(authedPage)
    await services.gotoById(serviceId)
    await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).fill('999,00')
    await authedPage.locator('form').getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Snapshot/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await expect(authedPage.getByText('Corte').first()).toBeVisible()
    await expect(authedPage.getByText('1 × R$ 50,00')).toBeVisible()
    await expect(authedPage.getByText('1 × R$ 999,00')).toHaveCount(0)
  })

  test('editar o agendamento depois da order não muda total nem comissão da order', async ({
    org,
    authedPage,
  }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Sem Drift',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 50 },
      unitIds: org.unitIds,
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Drift',
      mobile: uniqueWhatsapp(),
    })
    const appointmentId = await seedAppointment({
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
    await authedPage.getByRole('button', { name: /Cliente Drift/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByText('1 × R$ 50,00')).toBeVisible()

    await patchAppointmentSnapshot(org.orgId, appointmentId, {
      servicePriceCentsSnapshot: 99900,
      commissionSnapshot: { kind: 'percentage', value: 10 },
    })

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    const commissionSection = authedPage
      .locator('section')
      .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
    await expect(commissionSection).toBeVisible()
    await expect(commissionSection.getByText('· Corte Sem Drift')).toBeVisible()
    await expect(commissionSection.getByText('R$ 25,00').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 99,90')).toHaveCount(0)
    await expect(authedPage.getByText('R$ 999,00')).toHaveCount(0)

    await authedPage.goto('/reports/commissions')
    const commissionRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Sem Drift' })
    await expect(commissionRow).toBeVisible()
    await expect(commissionRow.getByText('R$ 25,00')).toBeVisible()
    await expect(commissionRow.getByText('R$ 99,90')).toHaveCount(0)
  })
})
