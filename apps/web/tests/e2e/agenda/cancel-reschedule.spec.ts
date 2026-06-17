import { expect, test } from '../fixtures'
import { seedAppointment, seedCustomer, seedService, type SeededTenant } from '../helpers/session'
import { AgendaPage } from '../pages'

// Retrofit pros PRs #725/#724 (issue #639) — cancel + reschedule via
// AppointmentDialog em modo edit. Cobre: abertura do dialog clicando
// num appointment existente, fluxo de confirmação do cancel, presença
// dos campos editáveis de date/time pro reschedule.

function seedAppointmentForTenant(tenant: SeededTenant): void {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
  })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Maria Cliente',
    whatsapp: '11988887777',
  })
  // BR is UTC-3. 14:00–14:30 BR == 17:00–17:30 UTC on 2026-08-12.
  seedAppointment({
    tenantId: tenant.tenantId,
    unitId: tenant.unitIds[0]!,
    professionalId: tenant.professionalIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-08-12T17:00:00.000Z',
    endAt: '2026-08-12T17:30:00.000Z',
    status: 'scheduled',
  })
}

test.describe('Agenda — cancelar + reagendar', { tag: '@critical' }, () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('clicar num agendamento abre o diálogo de edição', async ({ tenant, authedPage }) => {
    seedAppointmentForTenant(tenant)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria Cliente/ }).click()
    await expect(authedPage.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible()
  })

  test('fluxo de cancelamento mostra confirmação e permite voltar atrás', async ({
    tenant,
    authedPage,
  }) => {
    seedAppointmentForTenant(tenant)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria Cliente/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Editar agendamento' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancelar agendamento' }).click()
    await expect(dialog.getByText('Cancelar mesmo?')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Sim' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Não' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Não' }).click()
    // Confirmation collapses; the original cancel button comes back.
    await expect(dialog.getByText('Cancelar mesmo?')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Cancelar agendamento' })).toBeVisible()
  })

  test('diálogo de edição expõe campos de data + hora pro reagendamento', async ({
    tenant,
    authedPage,
  }) => {
    seedAppointmentForTenant(tenant)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria Cliente/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Editar agendamento' })

    // Date input pre-populated with the appointment's tenant-tz date.
    await expect(dialog.locator('input[name="date"]')).toHaveValue('2026-08-12')
    // Start time pre-populated with the appointment's tenant-tz time (14:00 BR).
    await expect(dialog.locator('input[name="startTime"]')).toHaveValue('14:00')
  })
})
