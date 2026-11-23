import { expect, test } from '../fixtures'
import { seedAppointment, seedCustomer, seedService } from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Agenda — fuso horário', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('data de início em UTC renderiza no fuso horário da empresa (BR)', async ({
    org,
    authedPage,
  }) => {
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Smoke' })
    const serviceId = await seedService(org.orgId, { name: 'Corte', durationMinutes: 30 })

    await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: org.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt: '2026-08-12T13:00:00.000Z',
      endAt: '2026-08-12T13:30:00.000Z',
    })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')

    await expect(authedPage.getByText(/10:00/).first()).toBeVisible()
    await expect(authedPage.getByText('Cliente Smoke').first()).toBeVisible()
  })
})
