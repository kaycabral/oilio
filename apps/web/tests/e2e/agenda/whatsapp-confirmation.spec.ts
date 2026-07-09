import { expect, test } from '../fixtures'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedAppointmentForCustomer(
  org: SeededOrg,
  opts: { mobile?: string; status?: 'scheduled' | 'cancelled' },
): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Maria WhatsApp',
    mobile: opts.mobile,
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-08-12T17:00:00.000Z',
    endAt: '2026-08-12T17:30:00.000Z',
    status: opts.status ?? 'scheduled',
  })
}

test.describe('Agenda — link WhatsApp de confirmação', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('link aparece pra agendamento agendado com WhatsApp', async ({ org, authedPage }) => {
    await seedAppointmentForCustomer(org, { mobile: uniqueWhatsapp() })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria WhatsApp/ }).click()

    const link = authedPage.getByRole('link', { name: /Enviar confirmação por WhatsApp/i })
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/)
  })

  test('link some pra agendamento cancelado', async ({ org, authedPage }) => {
    await seedAppointmentForCustomer(org, { mobile: uniqueWhatsapp(), status: 'cancelled' })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await agenda.showCancelledToggle().click()
    await authedPage.getByRole('button', { name: /Maria WhatsApp/ }).click()
    await expect(authedPage.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible()
    await expect(
      authedPage.getByRole('link', { name: /Enviar confirmação por WhatsApp/i }),
    ).toHaveCount(0)
  })
})
