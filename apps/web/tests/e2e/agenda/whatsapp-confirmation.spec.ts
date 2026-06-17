import { expect, test } from '../fixtures'
import { seedAppointment, seedCustomer, seedService, type SeededTenant } from '../helpers/session'
import { AgendaPage } from '../pages'

// Retrofit pro PR #726 (issue #638) — link "Enviar confirmação por
// WhatsApp" no edit dialog. Visível apenas quando appointment.status
// === 'scheduled' E o cliente tem whatsapp normalizável. Href deve
// começar com https://wa.me/ + dígitos.

function seedAppointmentForCustomer(
  tenant: SeededTenant,
  opts: { whatsapp?: string; status?: 'scheduled' | 'cancelled' },
): void {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
  })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Maria WhatsApp',
    whatsapp: opts.whatsapp,
  })
  seedAppointment({
    tenantId: tenant.tenantId,
    unitId: tenant.unitIds[0]!,
    professionalId: tenant.professionalIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-08-12T17:00:00.000Z',
    endAt: '2026-08-12T17:30:00.000Z',
    status: opts.status ?? 'scheduled',
  })
}

test.describe('Agenda — link WhatsApp de confirmação', () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('link aparece pra agendamento agendado com WhatsApp', async ({ tenant, authedPage }) => {
    seedAppointmentForCustomer(tenant, { whatsapp: '11988887777' })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria WhatsApp/ }).click()

    const link = authedPage.getByRole('link', { name: /Enviar confirmação por WhatsApp/i })
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/)
  })

  test('link some pra agendamento cancelado', async ({ tenant, authedPage }) => {
    seedAppointmentForCustomer(tenant, { whatsapp: '11988887777', status: 'cancelled' })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria WhatsApp/ }).click()
    await expect(authedPage.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible()
    await expect(
      authedPage.getByRole('link', { name: /Enviar confirmação por WhatsApp/i }),
    ).toHaveCount(0)
  })
})
