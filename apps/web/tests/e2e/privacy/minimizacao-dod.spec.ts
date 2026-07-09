import { expect, test } from '../fixtures'
import { seedCustomer, seedOpenOrder, seedService } from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Minimização de texto livre — DoD 0040 (#1108)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('cenário 1: convite de cliente sem campo de notas nem tags', async ({ authedPage }) => {
    await authedPage.goto('/customers')
    await authedPage.getByRole('button', { name: 'Convidar cliente' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.locator('input[name="whatsapp"]')).toBeVisible()
    await expect(dialog.locator('[name="tags"]')).toHaveCount(0)
    await expect(dialog.locator('textarea[name="notes"]')).toHaveCount(0)
    await expect(dialog.getByText('Observações')).toHaveCount(0)
    await dialog.locator('input[name="whatsapp"]').fill(`119${String(Date.now()).slice(-8)}`)
    await expect(dialog.getByRole('textbox', { name: 'Link do convite' })).toHaveValue(/\/signup\?/)
  })

  test('cenário 2: detalhe da venda sem campo de observações (só desconto)', async ({
    org,
    authedPage,
  }) => {
    const customerId = await seedCustomer(org.orgId, { name: `Cli Venda ${Date.now()}` })
    const orderId = await seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: org.uid,
    })
    await authedPage.goto(`/orders/${orderId}`)
    await expect(authedPage.locator('textarea[name="notes"]')).toHaveCount(0)
    await expect(authedPage.getByText('Observações')).toHaveCount(0)
    await expect(authedPage.locator('input[name="discount"]')).toBeVisible()
  })

  test('cenário 3: diálogo de agendamento sem campo de notas', async ({ org, authedPage }) => {
    await seedService(org.orgId, { name: 'Corte DoD', durationMinutes: 30, priceCents: 5000 })
    await seedCustomer(org.orgId, { name: `Cli Agenda ${Date.now()}` })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    const newBtn = agenda.newAppointmentButton()
    await expect(newBtn).toBeEnabled()
    await newBtn.click()
    const dialog = agenda.newAppointmentDialog()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('textarea[name="notes"]')).toHaveCount(0)
    await expect(dialog.getByText('Observações')).toHaveCount(0)
    await expect(dialog.getByText('Serviço', { exact: true })).toBeVisible()
  })
})
