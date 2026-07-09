import { expect, test } from '../fixtures'
import {
  seedCustomer,
  seedLoginableMemberOperation,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Agenda — diálogo de novo agendamento', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'incomplete',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('"+ Novo" fica desabilitado quando não há serviços', async ({ authedPage }) => {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    await expect(agenda.newAppointmentButton()).toBeDisabled()
  })

  test('"+ Novo" abre o diálogo com os campos esperados', async ({ org, authedPage }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      unitIds: [org.unitIds[0]!],
    })
    await seedLoginableMemberOperation(org.orgId, {
      unitIds: [org.unitIds[0]!],
      catalogServiceIds: [serviceId],
    })
    await seedCustomer(org.orgId, { name: 'João Teste', mobile: uniqueWhatsapp() })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    const newBtn = agenda.newAppointmentButton()
    await expect(newBtn).toBeEnabled()
    await newBtn.click()

    const dialog = agenda.newAppointmentDialog()
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText('Preencha cliente, serviço, profissional e horário.'),
    ).toBeVisible()
    await expect(dialog.getByText('Serviço', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Profissional', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Cliente', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Data', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Início', { exact: true })).toBeVisible()
  })
})
