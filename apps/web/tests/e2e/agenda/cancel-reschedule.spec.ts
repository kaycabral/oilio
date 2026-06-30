import { expect, test } from '../fixtures'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Retrofit pros PRs #725/#724 (issue #639) — cancel + reschedule via
// AppointmentDialog em modo edit. Cobre: abertura do dialog clicando
// num appointment existente, fluxo de confirmação do cancel, presença
// dos campos editáveis de date/time pro reschedule.

async function seedAppointmentForOrg(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Maria Cliente',
    whatsapp: uniqueWhatsapp(),
  })
  // BR is UTC-3. 14:00–14:30 BR == 17:00–17:30 UTC on 2026-08-12.
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-08-12T17:00:00.000Z',
    endAt: '2026-08-12T17:30:00.000Z',
    status: 'scheduled',
  })
}

test.describe('Agenda — cancelar + reagendar', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('clicar num agendamento abre o diálogo de edição', async ({ org, authedPage }) => {
    await seedAppointmentForOrg(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria Cliente/ }).click()
    await expect(authedPage.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible()
  })

  test('fluxo de cancelamento mostra confirmação e permite voltar atrás', async ({
    org,
    authedPage,
  }) => {
    await seedAppointmentForOrg(org)
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
    org,
    authedPage,
  }) => {
    await seedAppointmentForOrg(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await authedPage.getByRole('button', { name: /Maria Cliente/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Editar agendamento' })

    // Date input pre-populated with the appointment's org-tz date.
    await expect(dialog.locator('input[name="date"]')).toHaveValue('2026-08-12')
    // Start time pre-populated with the appointment's org-tz time (14:00 BR).
    await expect(dialog.locator('input[name="startTime"]')).toHaveValue('14:00')
  })
})
