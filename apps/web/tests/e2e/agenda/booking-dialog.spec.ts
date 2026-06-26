import { expect, test } from '../fixtures'
import { seedCustomer, seedService } from '../helpers/session'
import { AgendaPage } from '../pages'

// Retrofit pro PR #724 (issue #636) — internal booking dialog na agenda.
// O botão "+ Novo" só fica habilitado quando há unit + professional +
// service cadastrados (canCreate em AgendaView). Ao clicar, abre o
// Radix Dialog com title "Novo agendamento" e os campos do form.

test.describe('Agenda — diálogo de novo agendamento', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      // `incomplete` so the org fixture seeds NO service (the operational seed
      // now links one — brief 0068 D3/D4). The "+ Novo" gate keys on the catalog
      // having ≥1 service, and a unit-linked professional counts regardless of
      // operational status (`canCreate` in AgendaView, professionals filtered by
      // unit not by derive), so the first test's empty-catalog case holds and the
      // second seeds its own service.
      professionalOperationalStatus: 'incomplete',
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
    await seedService(org.orgId, { name: 'Corte', durationMinutes: 30, priceCents: 5000 })
    await seedCustomer(org.orgId, { name: 'João Teste', whatsapp: '11999990000' })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    // Wait for hydration before clicking — without this the click can fire
    // before React attaches the onClick handler (Turbopack race, see #763).
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
