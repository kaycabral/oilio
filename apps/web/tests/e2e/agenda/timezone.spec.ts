import { expect, test } from '../fixtures'
import { seedAppointment, seedCustomer, seedService } from '../helpers/session'
import { AgendaPage } from '../pages'

// Retrofit pro PR #720 (issue #719) — timezone awareness.
// Storage é UTC; display deve ser no fuso do org (default America/Sao_Paulo,
// UTC-3 no inverno em SP). Uma startAt UTC em 13:00 deve render como 10:00 BR.

test.describe('Agenda — fuso horário', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
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

    // Use a fixed BR date (any future weekday inside business hours).
    // BR is UTC-3 year-round (no DST since 2019). UTC 13:00 == BR 10:00.
    // Calendar date: 2026-08-12 (a Wednesday — inside Mon-Fri business hours).
    await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: org.professionalIds[0]!,
      customerId,
      serviceId,
      startAt: '2026-08-12T13:00:00.000Z',
      endAt: '2026-08-12T13:30:00.000Z',
    })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')

    // Appointment cell renders start time in BR tz (10:00, not 13:00).
    await expect(authedPage.getByText(/10:00/).first()).toBeVisible()
    await expect(authedPage.getByText('Cliente Smoke').first()).toBeVisible()
  })
})
